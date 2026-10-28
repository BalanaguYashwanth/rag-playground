from fastapi import APIRouter
from pathlib import Path
from typing import Annotated, Literal
from qdrant_client.models import Distance
from uuid import UUID, uuid4
from utils import extract_document
from pydantic import BaseModel, Field
from services.rag import create_rag, event_stream
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool
from fastapi import File, Form, HTTPException, UploadFile
from constant import USER_ID_PATTERN, MAX_DOCUMENT_BYTES, MAX_DOCUMENT_SIZE_LABEL, ALLOWED_FILE_TYPE

rag_router = APIRouter(prefix='/rag', tags=['rag'])

@rag_router.post('/build')
async def build_rag(
    file: Annotated[UploadFile, File()],
    user_id: Annotated[str, Form(pattern=USER_ID_PATTERN)],
    source: Annotated[Literal["custom", "pdf", "template"], Form()] = "custom",
    embedding_size: Annotated[str, Form()] = "0",
    distance: Annotated[Distance, Form()] = Distance.COSINE,
):
    try:
        if not embedding_size.isdigit():
            raise HTTPException(400, f"Embedding size should be number")
        if not distance in Distance:
            raise HTTPException(400, f"Distance is not matching")
        extension = Path(file.filename or "").suffix.lower()
        allowed_file_type = ALLOWED_FILE_TYPE
        if extension not in allowed_file_type:
            raise HTTPException(415, f"Only {allowed_file_type} files are accepted.")
        if (source == "pdf") != (extension == ".pdf"):
            raise HTTPException(422, "The document type does not match the selected source.")
        if file.size is not None and file.size > MAX_DOCUMENT_BYTES:
            raise HTTPException(413, f"Document exceeds {MAX_DOCUMENT_SIZE_LABEL}.")
        size = 0
        while chunk := await file.read(65536):
            size += len(chunk)
            if size > MAX_DOCUMENT_BYTES:
                raise HTTPException(413, f"Document exceeds {MAX_DOCUMENT_SIZE_LABEL}.")
        if not size:
            raise HTTPException(422, "Document is empty.")
        await file.seek(0)
        generator_text = await run_in_threadpool(extract_document, file.file, extension, source != "template")
        for text in generator_text:
            await run_in_threadpool(
                create_rag, 
                text, 
                user_id, 
                Path(file.filename or "").name,
                distance,
                embedding_size=int(embedding_size)
            )
        return {"user_id": user_id, "filename": Path(file.filename or "").name}
    except HTTPException:
        raise
    except Exception as error:
        print(f"Error occurred:", error)
        raise HTTPException(500, "Could not build the document index. Please try again.")
    finally:
        await file.close()

class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=12000)
    user_id: str = Field(pattern=USER_ID_PATTERN)
    document_id: UUID


@rag_router.post('/search')
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