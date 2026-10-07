import ast
import importlib.util
import io
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
        with patch.dict(sys.modules, {"controller": controller}):
            spec.loader.exec_module(self.app_module)
        self.controller = controller
        self.client = TestClient(self.app_module.app)

    def upload(self, body, filename="notes.txt", user_id=USER_ID):
        return self.client.post("/rag/build", data={"user_id": user_id, "source": "pdf" if filename.endswith(".pdf") else "custom"}, files={"file": (filename, body)})

    def test_text_upload_returns_scope_and_passes_metadata(self):
        response = self.upload(TEXT)
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result["user_id"], USER_ID)
        self.assertEqual(UUID(result["document_id"]).version, 4)
        self.controller.create_rag.assert_called_once_with(TEXT, USER_ID, result["document_id"], "notes.txt")

    def test_invalid_uploads_never_build(self):
        for content, filename, code in [
            ("short", "notes.txt", 422),
            ("", "notes.txt", 422),
            (b"\xff" * 100, "notes.txt", 422),
            (b"fake pdf", "notes.pdf", 422),
            (TEXT, "notes.exe", 415),
            (b"a" * (1024 * 1024 + 1), "notes.txt", 413),
            (b"a" * (1024 * 1024 + 100000), "notes.txt", 413),
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
        self.assertLess(len(content), 1024 * 1024)
        response = self.upload(content, sample.name)
        self.assertEqual(response.status_code, 200, response.text)
        extracted = self.controller.create_rag.call_args.args[0]
        self.assertIn("Mercury", extracted)
        self.assertIn("Saturn", extracted)

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


if __name__ == "__main__":
    unittest.main()