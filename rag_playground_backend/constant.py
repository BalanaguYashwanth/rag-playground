import os, json
from pathlib import Path

DOCUMENT_LIMITS = json.loads(Path(__file__).with_name("document_limits.json").read_text())
MAX_DOCUMENT_BYTES = DOCUMENT_LIMITS.get("max_document_bytes")
MIN_CUSTOM_TEXT_LINES = DOCUMENT_LIMITS.get("min_custom_text_lines")
MAX_PDF_PAGES = DOCUMENT_LIMITS.get("max_pdf_pages")
MAX_DOCUMENT_SIZE_LABEL = f"{MAX_DOCUMENT_BYTES / (1024 * 1024):g} MiB"
MAX_SEARCH_BODY_BYTES = 128 * 1024
USER_ID_PATTERN = r"^user_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
ALLOWED_FILE_TYPE = tuple(os.getenv("ALLOWED_FILE_TYPE", ".txt,.pdf").split(","))
CHUNK_SIZE = int(os.getenv('CHUNK_SIZE', 500))
CHUNK_OVERLAP = int(os.getenv('CHUNK_OVERLAP', 50))