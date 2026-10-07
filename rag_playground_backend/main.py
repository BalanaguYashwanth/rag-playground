import json
from pathlib import Path
from tempfile import TemporaryFile
from typing import Annotated, Literal
from uuid import UUID, uuid4
from pydantic import BaseModel, Field
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pypdf import PdfReader
from controller import create_rag, llm_output, rag_search
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from collections.abc import AsyncIterable
from starlette.concurrency import run_in_threadpool

MAX_DOCUMENT_BYTES = 1024 * 1024
USER_ID_PATTERN = r"^user_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"

class BuildBodyLimit:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["path"] != "/rag/build":
            return await self.app(scope, receive, send)
        with TemporaryFile() as body:
            total = 0
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                chunk = message.get("body", b"")
                total += len(chunk)
                if total > MAX_DOCUMENT_BYTES + 65536:
                    return await JSONResponse(status_code=413, content={"detail": "Upload exceeds 1 MiB."})(scope, receive, send)
                body.write(chunk)
                if not message.get("more_body", False):
                    break
            body.seek(0)

            async def limited_receive():
                chunk = body.read(65536)
                return {"type": "http.request", "body": chunk, "more_body": body.tell() < total}

            await self.app(scope, limited_receive, send)

app = FastAPI()
app.add_middleware(BuildBodyLimit)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get('/status')
def status():
    return {'status': 200}

@app.post('/rag/build')
async def build_rag(
    file: Annotated[UploadFile, File()],
    user_id: Annotated[str, Form(pattern=USER_ID_PATTERN)],
    source: Annotated[Literal["custom", "pdf", "template"], Form()] = "custom",
):
    try:
        extension = Path(file.filename or "").suffix.lower()
        if extension not in (".txt", ".pdf"):
            raise HTTPException(415, "Only .txt and .pdf files are accepted.")
        if (source == "pdf") != (extension == ".pdf"):
            raise HTTPException(422, "The document type does not match the selected source.")
        if file.size is not None and file.size > MAX_DOCUMENT_BYTES:
            raise HTTPException(413, "Document exceeds 1 MiB.")
        size = 0
        while chunk := await file.read(65536):
            size += len(chunk)
            if size > MAX_DOCUMENT_BYTES:
                raise HTTPException(413, "Document exceeds 1 MiB.")
        if not size:
            raise HTTPException(422, "Document is empty.")
        await file.seek(0)
        text = await run_in_threadpool(extract_document, file.file, extension, source != "template")
        document_id = str(uuid4())
        await run_in_threadpool(create_rag, text, user_id, document_id, Path(file.filename).name)
        return {"user_id": user_id, "document_id": document_id, "filename": Path(file.filename).name}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(500, "Could not build the document index. Please try again.")
    finally:
        await file.close()

def extract_document(source, extension: str, require_lines: bool = True) -> str:
    if extension == ".txt":
        try:
            text = source.read(MAX_DOCUMENT_BYTES + 1).decode("utf-8-sig")
        except UnicodeDecodeError:
            raise HTTPException(422, "Text files must use UTF-8 encoding.")
        if require_lines and len(text.splitlines()) < 100:
            raise HTTPException(422, "Text must contain at least 100 lines.")
    else:
        # PDF Reader
        try:
            if source.read(5) != b"%PDF-":
                raise HTTPException(422, "The file is not a valid PDF.")
            source.seek(0)
            reader = PdfReader(source)
            if reader.is_encrypted:
                raise HTTPException(422, "Encrypted PDFs are not supported.")
            if len(reader.pages) > 100:
                raise HTTPException(422, "PDFs may contain at most 100 pages.")
            parts = []
            extracted_size = 0
            for page in reader.pages:
                part = page.extract_text() or ""
                extracted_size += len(part.encode("utf-8")) + 1
                if extracted_size > MAX_DOCUMENT_BYTES:
                    raise HTTPException(413, "Extracted PDF text exceeds 1 MiB.")
                parts.append(part)
            text = "\n".join(parts)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(422, "Could not read this PDF.")
    if not text.strip() or "\x00" in text:
        raise HTTPException(422, "Document must contain readable text. Scanned PDFs require OCR.")
    return text

class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=12000)
    user_id: str = Field(pattern=USER_ID_PATTERN)
    document_id: UUID

def sse(event: str, data: dict | None = None) -> str:
    return f"event: {event}\ndata: {json.dumps(data or {})}\n\n"

async def event_stream(user_query, user_id, document_id) -> AsyncIterable[str]:
    try:
        yield sse("status", {"type": "tag", "stage":"searching", "message": "Searching documents"})
        vector_searches = await run_in_threadpool(rag_search, user_query, user_id, document_id)
        yield sse('status', {"type": "tag", 'stage':'retrieved', 'message':'Document Retrieved'})
        yield sse('status', {"type": "tag", 'stage':'generating', 'message':'Generating response'})
        if not vector_searches:
            yield sse('status', {'stage':'done', 'message': 'No data found'})
            return

        async for text in llm_output(vector_searches, user_query):
            yield sse("status", {'stage':'response', 'message': text})
        yield sse('status', {"type": "tag", 'stage': 'done', 'message':'Generated response'})
    except Exception as error:
        yield sse("status", {"stage":"error", "message": "Could not generate an answer."})
    
@app.post('/rag/search')
def search(request: SearchRequest):
    #TODO: SSE handles 500, so check how frontend reacts it ?
    user_query = request.query
    if not user_query:
        raise ValueError('User query is required')
    return StreamingResponse(
        event_stream(user_query, request.user_id, str(request.document_id)),
        media_type="text/event-stream",
        headers={
            "Cache-Control":"no-cache",
            "X-Accel-Buffering":"no"
        }
    )
    return {}