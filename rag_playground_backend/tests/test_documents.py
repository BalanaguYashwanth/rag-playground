import ast
import asyncio
import importlib.util
import io
from itertools import count
from pathlib import Path
import sys
from threading import Lock
from types import ModuleType
import unittest
from unittest.mock import Mock, patch
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings
from langchain_qdrant import QdrantVectorStore
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
from qdrant_client.models import Distance, FieldCondition, Filter, MatchValue, PayloadSchemaType, VectorParams
from qdrant_client import QdrantClient

ROOT = Path(__file__).resolve().parents[1]
USER_ID = f"user_{uuid4()}"
DOCUMENT_ID = str(uuid4())
CLIENT_SEQUENCE = count(1)
TEXT = "\n".join(f"Line {number}: document knowledge." for number in range(100))


class TestEmbeddings(Embeddings):
    def embed_documents(self, texts):
        return [[1.0, 0.0, 0.0] for text in texts]

    def embed_query(self, text):
        return [1.0, 0.0, 0.0]


class DocumentTests(unittest.TestCase):
    def setUp(self):
        controller = ModuleType("controller")
        controller.create_rag = Mock()
        controller.rag_search = Mock(return_value=None)
        controller.llm_output = Mock()
        spec = importlib.util.spec_from_file_location("document_test_app", ROOT / "main.py")
        self.app_module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"controller": controller}), patch.dict("os.environ", {
            "K_SERVICE": "", "REDIS_URL": "", "TRUSTED_PROXIES": "", "CORS_ALLOW_ORIGINS": "http://localhost:3000",
            "BUILD_RATE_LIMIT": "1000", "SEARCH_RATE_LIMIT": "1000", "GLOBAL_RATE_LIMIT": "1000",
        }):
            spec.loader.exec_module(self.app_module)
        self.controller = controller
        self.client = TestClient(self.app_module.app, client=(f"203.0.113.{next(CLIENT_SEQUENCE)}", 50000))

    def upload(self, body, filename="notes.txt", user_id=USER_ID):
        return self.client.post("/rag/build", data={"user_id": user_id, "source": "pdf" if filename.endswith(".pdf") else "custom"}, files={"file": (filename, body)})

    def test_text_upload_returns_scope_and_passes_metadata(self):
        response = self.upload(TEXT)
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result["user_id"], USER_ID)
        self.assertEqual(UUID(result["document_id"]).version, 4)
        self.controller.create_rag.assert_called_once_with(TEXT, USER_ID, result["document_id"], "notes.txt")

    def test_custom_text_line_boundary(self):
        self.assertEqual(self.app_module.MIN_CUSTOM_TEXT_LINES, 50)
        for lines, expected in [(49, 422), (50, 200)]:
            with self.subTest(lines=lines):
                self.controller.create_rag.reset_mock()
                text = "\n".join(f"Line {number}: document facts." for number in range(lines))
                response = self.upload(text)
                self.assertEqual(response.status_code, expected, response.text)
                if expected == 422:
                    self.assertEqual(response.json()["detail"], "Text must contain at least 50 lines.")
                    self.controller.create_rag.assert_not_called()
                else:
                    self.controller.create_rag.assert_called_once()

    def test_configured_custom_text_minimum_is_used(self):
        with patch.object(self.app_module, "MIN_CUSTOM_TEXT_LINES", 2):
            self.assertEqual(self.upload("one line").status_code, 422)
            self.controller.create_rag.assert_not_called()
            self.assertEqual(self.upload("first line\nsecond line").status_code, 200)

    def test_configured_size_limit_applies_to_every_source(self):
        with patch.object(self.app_module, "MAX_DOCUMENT_BYTES", 16):
            for source, filename in [("custom", "notes.txt"), ("template", "sample.txt"), ("pdf", "notes.pdf")]:
                with self.subTest(source=source):
                    response = self.client.post("/rag/build", data={"user_id": USER_ID, "source": source}, files={"file": (filename, b"a" * 17)})
                    self.assertEqual(response.status_code, 413, response.text)
        self.controller.create_rag.assert_not_called()

    def test_template_text_still_requires_valid_readable_utf8(self):
        for content in [b"", b" \n ", b"\xff", b"facts\x00"]:
            with self.subTest(content=content):
                response = self.client.post("/rag/build", data={"user_id": USER_ID, "source": "template"}, files={"file": ("sample.txt", content)})
                self.assertEqual(response.status_code, 422, response.text)
        self.controller.create_rag.assert_not_called()

    def test_local_browser_headers_do_not_trigger_attack_detection(self):
        client = TestClient(self.app_module.app, client=("127.0.0.1", 50001))
        response = client.post(
            "/rag/build",
            headers={"Origin": "http://localhost:3000", "Referer": "http://localhost:3000/"},
            data={"user_id": USER_ID, "source": "template"},
            files={"file": ("ocean-life.txt", "The ocean covers about 71 percent of Earth's surface.")},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["access-control-allow-origin"], "http://localhost:3000")
        self.assertTrue(self.app_module.security_config.enable_rate_limiting)
        self.controller.create_rag.assert_called_once()

    def test_local_referrer_does_not_bypass_rate_limiting(self):
        self.app_module.security_config.endpoint_rate_limits["/rag/build"] = (2, 60)
        for expected in (200, 200, 429):
            response = self.client.post(
                "/rag/build",
                headers={"Origin": "http://localhost:3000", "Referer": "http://localhost:3000/"},
                data={"user_id": f"user_{uuid4()}", "source": "template"},
                files={"file": ("sample.txt", "Document facts.")},
            )
            self.assertEqual(response.status_code, expected, response.text)
        self.assertEqual(self.controller.create_rag.call_count, 2)

    def test_untrusted_local_referrer_is_still_scanned(self):
        response = self.client.post(
            "/rag/build",
            headers={"Referer": "http://localhost:9999/"},
            data={"user_id": USER_ID, "source": "template"},
            files={"file": ("sample.txt", "Document facts.")},
        )
        self.assertEqual(response.status_code, 400)
        self.controller.create_rag.assert_not_called()

    def test_malformed_referrer_is_rejected_without_crashing(self):
        response = self.client.post(
            "/rag/build",
            headers={"Referer": "http://["},
            data={"user_id": USER_ID, "source": "template"},
            files={"file": ("sample.txt", "Document facts.")},
        )
        self.assertEqual(response.status_code, 400)
        self.controller.create_rag.assert_not_called()

    def test_search_stream_keeps_security_headers_and_answer(self):
        async def answer(context, question):
            yield "Document answer."

        self.controller.rag_search.return_value = "Document context"
        self.controller.llm_output.side_effect = answer
        response = self.client.post("/rag/search", json={"query": "question", "user_id": USER_ID, "document_id": DOCUMENT_ID})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn("Document answer.", response.text)
        self.assertIn('"stage": "done"', response.text)
        self.assertEqual(response.headers["x-content-type-options"], "nosniff")

    def test_oversized_search_is_rejected_before_retrieval(self):
        response = self.client.post("/rag/search", content=b"a" * (128 * 1024 + 1), headers={"Content-Type": "application/json"})
        self.assertEqual(response.status_code, 413, response.text)
        self.controller.rag_search.assert_not_called()

    def test_invalid_uploads_never_build(self):
        for content, filename, code in [
            ("short", "notes.txt", 422),
            ("", "notes.txt", 422),
            (b"\xff" * 100, "notes.txt", 422),
            (b"fake pdf", "notes.pdf", 422),
            (TEXT, "notes.exe", 415),
            (b"a" * (self.app_module.MAX_DOCUMENT_BYTES + 1), "notes.txt", 413),
            (b"a" * (self.app_module.MAX_DOCUMENT_BYTES + 100000), "notes.txt", 413),
        ]:
            with self.subTest(filename=filename, code=code):
                self.assertEqual(self.upload(content, filename).status_code, code)
        self.controller.create_rag.assert_not_called()

    def test_user_id_is_required_and_validated(self):
        self.assertEqual(self.upload(TEXT, user_id="user_invalid").status_code, 422)
        self.controller.create_rag.assert_not_called()

    def test_template_text_can_be_shorter_and_source_must_match(self):
        response = self.client.post("/rag/build", data={"user_id": USER_ID, "source": "template"}, files={"file": ("template.txt", "Curated document facts.")})
        self.assertEqual(response.status_code, 200)
        response = self.client.post("/rag/build", data={"user_id": USER_ID, "source": "pdf"}, files={"file": ("notes.txt", TEXT)})
        self.assertEqual(response.status_code, 422)

    def test_pdf_extraction_and_empty_pdf(self):
        writer = PdfWriter()
        page = writer.add_blank_page(width=300, height=300)
        output = io.BytesIO()
        writer.write(output)
        self.assertEqual(self.upload(output.getvalue(), "blank.pdf").status_code, 422)
        font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")})
        page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})})
        content = DecodedStreamObject()
        content.set_data(b"BT /F1 12 Tf 10 200 Td (Document facts) Tj ET")
        page[NameObject("/Contents")] = writer._add_object(content)
        output = io.BytesIO()
        writer.write(output)
        response = self.upload(output.getvalue(), "facts.pdf")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn("Document facts", self.controller.create_rag.call_args.args[0])

    def test_downloadable_sample_pdf_builds(self):
        sample = ROOT.parent / "rag-playground-frontend" / "public" / "samples" / "solar-system.pdf"
        content = sample.read_bytes()
        self.assertLess(len(content), self.app_module.MAX_DOCUMENT_BYTES)
        response = self.upload(content, sample.name)
        self.assertEqual(response.status_code, 200, response.text)
        extracted = self.controller.create_rag.call_args.args[0]
        self.assertIn("Mercury", extracted)
        self.assertIn("Saturn", extracted)

    def test_configured_pdf_page_limit_and_encryption_are_checked(self):
        writer = PdfWriter()
        for _ in range(2):
            writer.add_blank_page(width=300, height=300)
        output = io.BytesIO()
        writer.write(output)
        with patch.object(self.app_module, "MAX_PDF_PAGES", 1):
            response = self.upload(output.getvalue(), "notes.pdf")
            self.assertEqual(response.status_code, 422)
            self.assertEqual(response.json()["detail"], "PDFs may contain at most 1 pages.")
        writer.encrypt("test-password")
        output = io.BytesIO()
        writer.write(output)
        response = self.upload(output.getvalue(), "notes.pdf")
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], "Encrypted PDFs are not supported.")
        self.controller.create_rag.assert_not_called()

    def test_search_requires_both_ids_and_forwards_them(self):
        self.assertEqual(self.client.post("/rag/search", json={"query": "question"}).status_code, 422)
        response = self.client.post("/rag/search", json={"query": "question", "user_id": USER_ID, "document_id": DOCUMENT_ID})
        self.assertEqual(response.status_code, 200)
        self.controller.rag_search.assert_called_once_with("question", USER_ID, DOCUMENT_ID)

    def test_chunks_and_vector_search_are_scoped(self):
        tree = ast.parse((ROOT / "controller.py").read_text())
        functions = ast.Module(body=[node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in ("create_rag", "rag_search")], type_ignores=[])
        store = Mock()
        store.similarity_search.return_value = [Document(page_content="Scoped answer")]
        client = Mock()
        client.collection_exists.return_value = True
        namespace = {
            "Document": Document, "RecursiveCharacterTextSplitter": RecursiveCharacterTextSplitter,
            "QdrantVectorStore": Mock(return_value=store), "get_embeddings": Mock(), "client": client,
            "build_lock": Lock(), "EMBEDDINGS_COLLECTION_NAME": "test", "Filter": Filter,
            "FieldCondition": FieldCondition, "MatchValue": MatchValue, "PayloadSchemaType": PayloadSchemaType,
            "VectorParams": VectorParams, "Distance": Distance, "logger": Mock(),
        }
        exec(compile(functions, "controller.py", "exec"), namespace)
        namespace["create_rag"](TEXT, USER_ID, DOCUMENT_ID, "notes.txt")
        chunks = [chunk for call in store.add_documents.call_args_list for chunk in call.args[0]]
        self.assertTrue(chunks)
        self.assertTrue(all(chunk.metadata["user_id"] == USER_ID and chunk.metadata["document_id"] == DOCUMENT_ID for chunk in chunks))
        self.assertEqual(namespace["rag_search"]("question", USER_ID, DOCUMENT_ID), "Scoped answer")
        conditions = store.similarity_search.call_args.kwargs["filter"].must
        self.assertEqual({condition.key: condition.match.value for condition in conditions}, {
            "metadata.user_id": USER_ID, "metadata.document_id": DOCUMENT_ID,
        })

    def test_qdrant_excludes_other_users_and_documents(self):
        client = QdrantClient(":memory:")
        try:
            client.create_collection("documents", vectors_config=VectorParams(size=3, distance=Distance.COSINE))
            store = QdrantVectorStore(client=client, collection_name="documents", embedding=TestEmbeddings())
            store.add_documents([
                Document(page_content="Intended document", metadata={"user_id": USER_ID, "document_id": DOCUMENT_ID}),
                Document(page_content="Other user's document", metadata={"user_id": f"user_{uuid4()}", "document_id": DOCUMENT_ID}),
                Document(page_content="Same user's other document", metadata={"user_id": USER_ID, "document_id": str(uuid4())}),
            ])
            tree = ast.parse((ROOT / "controller.py").read_text())
            function = ast.Module(body=[node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "rag_search"], type_ignores=[])
            namespace = {
                "get_embeddings": TestEmbeddings, "QdrantVectorStore": QdrantVectorStore,
                "client": client, "EMBEDDINGS_COLLECTION_NAME": "documents", "Filter": Filter,
                "FieldCondition": FieldCondition, "MatchValue": MatchValue, "logger": Mock(),
            }
            exec(compile(function, "controller.py", "exec"), namespace)
            self.assertEqual(namespace["rag_search"]("question", USER_ID, DOCUMENT_ID), "Intended document")
            self.assertIsNone(namespace["rag_search"]("question", USER_ID, str(uuid4())))
        finally:
            client.close()


class SecurityConfigurationTests(unittest.TestCase):
    def test_forwarded_ip_is_only_used_from_a_trusted_peer(self):
        from guard import SecurityConfig
        from guard.adapters import StarletteGuardRequest
        from guard_core.utils import extract_client_ip
        from starlette.requests import Request

        config = SecurityConfig(enable_redis=False, trusted_proxies=["10.0.0.1"], trusted_proxy_depth=1)
        for peer, chain, expected in [
            ("203.0.113.60", "198.51.100.1", "203.0.113.60"),
            ("10.0.0.1", "198.51.100.99, 203.0.113.60", "203.0.113.60"),
            ("10.0.0.1", "198.51.100.98, 203.0.113.60", "203.0.113.60"),
        ]:
            scope = {"type": "http", "method": "POST", "path": "/rag/search", "scheme": "http", "query_string": b"", "client": (peer, 50000), "headers": [(b"x-forwarded-for", chain.encode())]}
            request = StarletteGuardRequest(Request(scope))
            self.assertEqual(asyncio.run(extract_client_ip(request, config)), expected)

    def test_cloud_run_requires_explicit_origins(self):
        from security import create_security_config

        with patch.dict("os.environ", {"K_SERVICE": "rag", "REDIS_URL": "", "CORS_ALLOW_ORIGINS": "", "TRUSTED_PROXIES": ""}):
            with self.assertRaisesRegex(ValueError, "Cloud Run requires"):
                create_security_config()

    def test_cloud_run_allows_empty_redis_and_proxies(self):
        from fastapi import FastAPI
        from security import APISecurityMiddleware, create_security_config
        from guard.adapters import StarletteGuardRequest
        from guard_core.utils import extract_client_ip
        from starlette.requests import Request

        with patch.dict("os.environ", {
            "K_SERVICE": "rag", "REDIS_URL": "", "TRUSTED_PROXIES": "",
            "CORS_ALLOW_ORIGINS": "https://rag.playground.reezoai.com",
        }):
            config = create_security_config()
        self.assertFalse(config.enable_redis)
        self.assertIsNone(config.redis_url)
        self.assertFalse(config.trusted_proxies)
        self.assertFalse(config.trust_x_forwarded_proto)
        self.assertFalse(config.enforce_https)
        self.assertTrue(config.enable_rate_limiting)
        self.assertTrue(config.enable_penetration_detection)
        self.assertEqual(config.cors_allow_origins, ["https://rag.playground.reezoai.com"])
        scope = {
            "type": "http", "method": "GET", "path": "/probe", "scheme": "http",
            "query_string": b"", "client": ("203.0.113.200", 50000),
            "headers": [(b"x-forwarded-for", b"198.51.100.99"), (b"x-forwarded-proto", b"https")],
        }
        self.assertEqual(asyncio.run(extract_client_ip(StarletteGuardRequest(Request(scope)), config)), "203.0.113.200")
        app = FastAPI()
        app.add_middleware(APISecurityMiddleware, config=config)

        @app.get("/probe")
        def probe():
            return {"ok": True}

        client = TestClient(app, client=("203.0.113.200", 50000))
        response = client.get("/probe", headers={"X-Forwarded-Proto": "https"})
        self.assertEqual(response.status_code, 200, response.text)

    def test_cloud_run_rejects_non_https_origins_without_redis_or_proxies(self):
        from security import create_security_config

        with patch.dict("os.environ", {
            "K_SERVICE": "rag", "REDIS_URL": "", "TRUSTED_PROXIES": "",
            "CORS_ALLOW_ORIGINS": "http://frontend.example",
        }):
            with self.assertRaisesRegex(ValueError, "must use HTTPS"):
                create_security_config()

    def test_catch_all_proxy_trust_and_wildcard_origins_are_rejected(self):
        from security import create_security_config

        with patch.dict("os.environ", {"K_SERVICE": "", "TRUSTED_PROXIES": "0.0.0.0/0"}):
            with self.assertRaisesRegex(ValueError, "every address"):
                create_security_config()
        with patch.dict("os.environ", {"K_SERVICE": "", "TRUSTED_PROXIES": "", "CORS_ALLOW_ORIGINS": "*"}):
            with self.assertRaisesRegex(ValueError, "explicit frontend origins"):
                create_security_config()

    def test_cloud_run_security_fails_closed_and_does_not_scan_documents(self):
        from security import create_security_config

        with patch.dict("os.environ", {
            "K_SERVICE": "rag", "REDIS_URL": "redis://redis.invalid:6379/0",
            "CORS_ALLOW_ORIGINS": "https://frontend.example", "TRUSTED_PROXIES": "192.0.2.10/32",
        }):
            config = create_security_config()
        self.assertTrue(config.enable_redis)
        self.assertFalse(config.redis_fail_open)
        self.assertTrue(config.enforce_https)
        self.assertFalse(config.detection_scan_body)
        self.assertEqual(config.cors_allow_origins, ["https://frontend.example"])


class ConcurrencyTests(unittest.IsolatedAsyncioTestCase):
    async def test_throttle_holds_slot_until_response_finishes_and_releases_it(self):
        from security import ConcurrencyLimitMiddleware

        for path in ("/rag/build", "/rag/search"):
            with self.subTest(path=path):
                started = asyncio.Event()
                release = asyncio.Event()

                async def endpoint(scope, receive, send):
                    await send({"type": "http.response.start", "status": 200, "headers": []})
                    started.set()
                    await release.wait()
                    await send({"type": "http.response.body", "body": b"done", "more_body": False})

                middleware = ConcurrencyLimitMiddleware(endpoint, build_limit=1, search_limit=1)
                scope = {"type": "http", "method": "POST", "path": path}
                messages = []

                async def send(message):
                    messages.append(message)

                async def receive():
                    return {"type": "http.request", "body": b"", "more_body": False}

                first = asyncio.create_task(middleware(scope, receive, send))
                try:
                    await asyncio.wait_for(started.wait(), 3)
                    await middleware(scope, receive, send)
                    busy = [message for message in messages if message["type"] == "http.response.start" and message["status"] == 429]
                    self.assertEqual(len(busy), 1)
                    self.assertIn((b"retry-after", b"5"), busy[0]["headers"])
                finally:
                    release.set()
                    await asyncio.wait_for(first, 3)
                messages.clear()
                await middleware(scope, receive, send)
                self.assertEqual(messages[0]["status"], 200)


if __name__ == "__main__":
    unittest.main()