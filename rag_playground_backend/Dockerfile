FROM python:3.13-slim-bookworm

# 1. Copy UV binary
COPY --from=ghcr.io/astral-sh/uv:0.6.17 /uv /uvx /bin/

WORKDIR /code

# 2. Environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/code/.venv/bin:$PATH" \
    HF_HOME=/opt/huggingface \
    HF_HUB_DISABLE_TELEMETRY=1 \
    TOKENIZERS_PARALLELISM=false \
    OMP_NUM_THREADS=2 \
    MKL_NUM_THREADS=2

# 3. System packages & User setup
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --create-home app \
    && mkdir -p /opt/huggingface /code \
    && chown -R app:app /opt/huggingface /code

# 4. Copy dependency files and set ownership
COPY --chown=app:app pyproject.toml uv.lock ./

# Switch to app user early so virtualenv and cached models belong to app
USER app

# 5. Sync dependencies using build cache
RUN uv sync --frozen --no-dev --no-install-project \
    && rm -rf /home/app/.cache/uv

# 6. Pre-download model weights into HF_HOME as app user
RUN python -c "from sentence_transformers import SentenceTransformer; model = SentenceTransformer('sentence-transformers/all-mpnet-base-v2', device='cpu'); assert model.get_sentence_embedding_dimension() == 768"

# Enforce offline mode AFTER downloading model weights
ENV HF_HUB_OFFLINE=1

# 7. Copy application code
COPY --chown=app:app . .

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/status', timeout=3)"

# Use python module call for correct signal passing
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-proxy-headers"]