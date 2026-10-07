import json
from pydantic import BaseModel
from fastapi import FastAPI
from controller import create_rag, llm_output, rag_search
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from collections.abc import AsyncIterable
from starlette.concurrency import run_in_threadpool, iterate_in_threadpool

app = FastAPI()

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
def build_rag():
    try:
        #TODO: Restrict coding files/data etc
        create_rag()
        return {'response':'successfully built'}
    except:
        return {'status':'something went wrong'}, 500

class SearchRequest(BaseModel):
    query: str

def sse(event: str, data: dict | None = None) -> str:
    return f"event: {event}\ndata: {json.dumps(data or {})}\n\n"

async def event_stream(user_query) -> AsyncIterable[str]:
    try:
        yield sse("status", {"type": "tag", "stage":"searching", "message": "Searching documents"})
        vector_searches = await run_in_threadpool(rag_search, user_query)
        yield sse('status', {"type": "tag", 'stage':'retrieved', 'message':'Document Retrieved'})
        yield sse('status', {"type": "tag", 'stage':'generating', 'message':'Generating response'})
        if not vector_searches:
            yield sse('status', {'stage':'done', 'message': 'No data found'})
            return

        async for text in llm_output(vector_searches, user_query):
            yield sse("status", {'stage':'response', 'message': text})
        yield sse('status', {"type": "tag", 'stage': 'done', 'message':'Generated response'})
    except Exception as error:
        yield sse("status", {"stage":"error", "message": error})
    
@app.post('/rag/search')
def search(request: SearchRequest):
    #TODO: SSE handles 500, so check how frontend reacts it ?
    user_query = request.query
    if not user_query:
        raise ValueError('User query is required')
    return StreamingResponse(
        event_stream(user_query),
        media_type="text/event-stream",
        headers={
            "Cache-Control":"text/event-stream",
            "X-Accel-Buffering":"no"
        }
    )
    return {}