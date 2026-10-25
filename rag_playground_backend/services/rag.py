import logging
from functools import lru_cache
from threading import Lock
from collections.abc import AsyncIterable
from starlette.concurrency import run_in_threadpool
from langchain.chat_models import init_chat_model
from langchain_core.documents import Document
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_qdrant import QdrantVectorStore
from qdrant_client import QdrantClient
from qdrant_client.models import VectorParams, Distance, Filter, FieldCondition, MatchValue, PayloadSchemaType
from langchain_text_splitters import RecursiveCharacterTextSplitter
from config import QDRANT_API_URL, QDRANT_API_KEY, EMBEDDINGS_COLLECTION_NAME
from constant import CHUNK_SIZE, CHUNK_OVERLAP

from dotenv import load_dotenv
from utils import normalize_filename, send_email, sse

load_dotenv()
logger = logging.getLogger(__name__)

client = QdrantClient(
    api_key=QDRANT_API_KEY,
    url=QDRANT_API_URL
)
build_lock = Lock()

@lru_cache(maxsize=1)
def get_embeddings(embedding_size):
    if embedding_size < 400:
        return HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
    return HuggingFaceEmbeddings()

def create_rag(text: str, user_id: str, document_id: str, filename: str, distance: Distance, embedding_size:int):
    with build_lock:
        splitter = RecursiveCharacterTextSplitter(chunk_size=CHUNK_SIZE, chunk_overlap=int(CHUNK_OVERLAP))
        total_chunks = []
        if len(text) < CHUNK_SIZE:
            total_chunks.append(text)
        else:
            chunks = splitter.split_text(text)
            total_chunks.extend(chunks)
        
        total_chunks.extend([
            Document(
                id=f"{document_id}_{normalize_filename(filename)}_chunk_'{str(index)}",
                page_content=chunk,
                metadata={"user_id": user_id, "document_id": document_id, "source": filename,}
            ) for index, chunk in enumerate(total_chunks)])
        
        send_email(type="create_rag", context=document_id, input=user_id)
        embeddings_model = get_embeddings(embedding_size)
        if not client.collection_exists(EMBEDDINGS_COLLECTION_NAME):
            client.create_collection(
                collection_name=EMBEDDINGS_COLLECTION_NAME,
                vectors_config=VectorParams(
                    size=len(embeddings_model.embed_query("dimension check")),
                    distance=distance
                )
            )
        for field in ("metadata.user_id", "metadata.document_id"):
            client.create_payload_index(
                collection_name=EMBEDDINGS_COLLECTION_NAME,
                field_name=field,
                field_schema=PayloadSchemaType.KEYWORD,
                wait=True,
            )

        collection = QdrantVectorStore(
                client=client,
                collection_name=EMBEDDINGS_COLLECTION_NAME,
                embedding=embeddings_model
            )

        for offset in range(0, len(total_chunks), 32):
            collection.add_documents(total_chunks[offset:offset + 32])

def rag_search(input: str, user_id: str, document_id: str):
    try:
        if not input:
            raise ValueError('User input is required')
        embedding_model = get_embeddings()
        vector_store = QdrantVectorStore(
            client=client,
            collection_name=EMBEDDINGS_COLLECTION_NAME,
            embedding=embedding_model
        )
        results = vector_store.similarity_search(input, k=2, filter=Filter(must=[
            FieldCondition(key="metadata.user_id", match=MatchValue(value=user_id)),
            FieldCondition(key="metadata.document_id", match=MatchValue(value=document_id)),
        ]))
        rag_search_result = []
        for result in results:
            rag_search_result.append(result.page_content)
        if not rag_search_result:
            return None
        search_results = "\n".join(rag_search_result)
        return search_results
    except ValueError:
        raise
    except Exception as error:
        logger.exception("Retrieval failed for input user query=%r error=%s", input, error)
        raise Exception("Error in search document")


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

async def llm_output(context: str, input: str):
    try:
        #TODO: Resolve AFC message by re-implementing with chat prompt template with model check campusx video
        llm_model = init_chat_model("google_genai:gemini-3.5-flash-lite")
        prompt = f"system: you are helpful assistant and \n here is the context {context} and user query \n {input} based on it respond accordingly"
        send_email(type="rag_search", context=context[:50], input=input)
        async for chunk in llm_model.astream(prompt): # replace with prompt template and gemini chat completions and system
            content = getattr(chunk, "content", None)
            if isinstance(content, list) and chunk.content and isinstance(chunk.content[0], dict):
                if chunk.content[0].get('text'):
                    yield chunk.content[0].get('text')
    except Exception as error:
        logger.exception("Error generating LLM response for user input=%r & error=%s", input, error)
        raise Exception("Error generating response")