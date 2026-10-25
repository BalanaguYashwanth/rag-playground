import os, re, asyncio, logging, smtplib, json
from email.message import EmailMessage
from tempfile import TemporaryFile
from dotenv import load_dotenv
from pypdf import PdfReader
from fastapi.responses import JSONResponse
from fastapi import HTTPException
from constant import (
    MAX_DOCUMENT_BYTES, 
    MAX_DOCUMENT_SIZE_LABEL, 
    MIN_CUSTOM_TEXT_LINES, 
    MAX_PDF_PAGES, 
    MAX_SEARCH_BODY_BYTES,
    CHUNK_SIZE
)

load_dotenv()

logger = logging.getLogger(__name__)
TO_EMAIL_ADDRESS = str(os.getenv('TO_EMAIL_ADDRESS'))
FROM_EMAIL_ADDRESS = str(os.getenv('FROM_EMAIL_ADDRESS'))
FROM_EMAIL_APP_PASSWORD = str(os.getenv('FROM_EMAIL_APP_PASSWORD'))
TRACK_ACTIVITY_ON_EMAIL = int(os.getenv('TRACK_ACTIVITY_ON_EMAIL', 0))

def sse(event: str, data: dict | None = None) -> str:
    return f"event: {event}\ndata: {json.dumps(data or {})}\n\n"

def send_email(type:str, context: str, input: str):
    """
    Send an email with the activity details.

    Args:
        type (str): The type of RAG activity.
        context (str): The context of the RAG activity.
        input (str): The user query related to the RAG activity.
    """
    try:
        if not TRACK_ACTIVITY_ON_EMAIL:
            return
        msg = EmailMessage()
        from_email = FROM_EMAIL_ADDRESS
        from_email_app_password = FROM_EMAIL_APP_PASSWORD 
        msg['Subject'] = 'RAG Search Result'
        msg['From'] = from_email
        msg['To'] = TO_EMAIL_ADDRESS
        msg.set_content(f"RAG Activity Type: {type}\n\n Context: {context}\n\n User Query: {input}")
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(from_email, from_email_app_password)
            server.send_message(msg)
    except Exception as error:
        logger.exception("Error sending email for context=%r & input=%r & error=%s", context, input, error)

def extract_document(source, extension: str, require_lines: bool = True):
    if extension == ".txt":
        try:
            text = source.read(MAX_DOCUMENT_BYTES + 1).decode("utf-8-sig")
        except UnicodeDecodeError:
            raise HTTPException(422, "Text files must use UTF-8 encoding.")

        if len(text.encode("utf-8")) > MAX_DOCUMENT_BYTES:
            raise HTTPException(413, f"Document exceeds {MAX_DOCUMENT_SIZE_LABEL}.")

        if require_lines and len(text.splitlines()) < MIN_CUSTOM_TEXT_LINES:
            raise HTTPException(422, f"Text must contain at least {MIN_CUSTOM_TEXT_LINES} lines.")

        if not text.strip() or "\x00" in text:
            raise HTTPException(
                422,
                "Document must contain readable text. Scanned PDFs require OCR."
            )

        yield text
        return

    # PDF Reader
    try:
        if source.read(5) != b"%PDF-":
            raise HTTPException(422, "The file is not a valid PDF.")

        source.seek(0)
        reader = PdfReader(source)

        if reader.is_encrypted:
            raise HTTPException(422, "Encrypted PDFs are not supported.")

        if len(reader.pages) > MAX_PDF_PAGES:
            raise HTTPException(422, f"PDFs may contain at most {MAX_PDF_PAGES} pages.")

        parts = []
        extracted_size = 0
        batch_size = 100 * CHUNK_SIZE

        for page in reader.pages:
            part = page.extract_text() or ""
            extracted_size += len(part.encode("utf-8")) + 1

            if extracted_size > MAX_DOCUMENT_BYTES:
                raise HTTPException(413, f"Extracted PDF text exceeds {MAX_DOCUMENT_SIZE_LABEL}.")

            parts.append(part)
            if sum(len(p) for p in parts) >= batch_size:
                text = "\n".join(parts)

                if text.strip():
                    if "\x00" in text:
                        raise HTTPException(422, "Document contains invalid text.")
                    yield text

                parts = []

        # Yield remaining pages
        text = "\n".join(parts)

        if text.strip():
            if "\x00" in text:
                raise HTTPException(422, "Document contains invalid text.")
            yield text

    except HTTPException:
        raise
    except Exception:
        raise HTTPException(422, "Could not read this PDF.")

class BuildBodyLimit:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] != "POST":
            return await self.app(scope, receive, send)
        limit = MAX_DOCUMENT_BYTES + 65536 if scope["path"] == "/rag/build" else MAX_SEARCH_BODY_BYTES
        with TemporaryFile() as body:
            total = 0
            try:
                async with asyncio.timeout(15):
                    while True:
                        message = await receive()
                        if message["type"] == "http.disconnect":
                            return
                        chunk = message.get("body", b"")
                        total += len(chunk)
                        if total > limit:
                            return await JSONResponse(status_code=413, content={"detail": "Request body is too large."})(scope, receive, send)
                        body.write(chunk)
                        if not message.get("more_body", False):
                            break
            except TimeoutError:
                return await JSONResponse(status_code=408, content={"detail": "Request upload took too long."})(scope, receive, send)
            body.seek(0)
            replayed_complete = False

            async def limited_receive():
                nonlocal replayed_complete
                if replayed_complete:
                    return await receive()
                chunk = body.read(65536)
                replayed_complete = body.tell() >= total
                return {"type": "http.request", "body": chunk, "more_body": not replayed_complete}

            await self.app(scope, limited_receive, send)

def normalize_filename(filename: str) -> str:
    return re.sub(r"[^\w.-]+", "_", filename).strip("_")