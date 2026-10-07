# rag-playground
## RAG Playground

Playground for quick RAG on your own documents.

Features
- SSE
- Multiple chunking strategies
- Multiple embedding models
- Vector search
- Metadata filtering
- Reranking
- RAG evaluation
- LLM comparison
- Evals

## Quick Start

### Frontend 

```bash
cd rag-playground-frontend
pnpm install
pnpm run dev
```

### Backend

```bash
cd rag_playground_backend
source .venv/bin/activate
python -m uvicorn main:app --reload
```

## Package Managers & Version

### Frontend
```
pnpm & Next.js v16.3.8
```

### Backend
```
uv & FastAPI v3.13
```


## Environment Variables

### Frontend
```bash
NEXT_PUBLIC_API_URL = "http://127.0.0.1:8000"
```

### Backend
```bash
EMBEDDINGS_COLLECTION_NAME = ""
QDRANT_API_KEY = ""
QDRANT_API_URL = ""
GOOGLE_API_KEY = ""
```

