import logging
from functools import lru_cache
from threading import Lock
from langsmith import Client
from uuid import uuid5, NAMESPACE_DNS
from collections.abc import AsyncIterable
from starlette.concurrency import run_in_threadpool
from langchain_core.documents import Document
from langchain_core.output_parsers import StrOutputParser
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_qdrant import QdrantVectorStore
from langchain_core.prompts import ChatPromptTemplate
from langchain_google_genai import GoogleGenerativeAI
from qdrant_client import QdrantClient
from qdrant_client.models import VectorParams, Distance, Filter, FieldCondition, MatchValue, PayloadSchemaType
from langchain_text_splitters import RecursiveCharacterTextSplitter
from db_handler.conversation_handler import ConversationHandler
from config import QDRANT_API_URL, QDRANT_API_KEY, EMBEDDINGS_COLLECTION_NAME, PROMPT_TEMPLATE
from constant import CHUNK_SIZE, CHUNK_OVERLAP

from dotenv import load_dotenv
from utils import normalize_filename, send_email, sse

load_dotenv()
logger = logging.getLogger(__name__)

qdrant_client = QdrantClient(
    api_key=QDRANT_API_KEY,
    url=QDRANT_API_URL
)
build_lock = Lock()

@lru_cache(maxsize=1)
def get_embeddings(embedding_size=399):
    if embedding_size < 400:
        return HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
    return HuggingFaceEmbeddings()

def create_rag(text: str, user_id: str, filename: str, distance: Distance, embedding_size:int):
    try:
        with build_lock:
            splitter = RecursiveCharacterTextSplitter(chunk_size=CHUNK_SIZE, chunk_overlap=int(CHUNK_OVERLAP))
            total_chunks = []
            if len(text) < CHUNK_SIZE:
                total_chunks.append(text)
            else:
                chunks = splitter.split_text(text)
                total_chunks.extend(chunks)
            
            embeddings_model = get_embeddings(embedding_size)
            embeddings_model_name = embeddings_model.model_name
            embeddings_model_size = len(embeddings_model.embed_query("dimension check"))
            total_chunks = [
                Document(
                    id=str(uuid5(NAMESPACE_DNS,f"{normalize_filename(filename)}_chunk_{index}")),
                    page_content=chunk,
                    metadata={
                        "user_id": user_id,
                        "source": filename,
                        "embeddings_model_name": embeddings_model_name, 
                        "embeddings_model_size": embeddings_model_size
                    }
                ) for index, chunk in enumerate(total_chunks)]
            
            send_email(type="create_rag", context="", input=user_id)
            if not qdrant_client.collection_exists(EMBEDDINGS_COLLECTION_NAME):
                qdrant_client.create_collection(
                    collection_name=EMBEDDINGS_COLLECTION_NAME,
                    vectors_config=VectorParams(
                        size=embeddings_model_size,
                        distance=distance
                    )
                )

                for field in ["metadata.user_id", ]:
                    qdrant_client.create_payload_index(
                        collection_name=EMBEDDINGS_COLLECTION_NAME,
                        field_name=field,
                        field_schema=PayloadSchemaType.KEYWORD,
                        wait=True,
                    )

            collection = QdrantVectorStore(
                    client=qdrant_client,
                    collection_name=EMBEDDINGS_COLLECTION_NAME,
                    embedding=embeddings_model
                )

            for offset in range(0, len(total_chunks), 32):
                collection.add_documents(total_chunks[offset:offset + 32])
    except Exception as error:
        logger.exception("Rag build failed:", error)
        raise Exception("Couldn't build the rag")

def rag_search(input: str, user_id: str):
    try:
        if not input:
            raise ValueError('User input is required')
        embedding_model = get_embeddings()
        vector_store = QdrantVectorStore(
            client=qdrant_client,
            collection_name=EMBEDDINGS_COLLECTION_NAME,
            embedding=embedding_model
        )
        results = vector_store.similarity_search(input, k=2, filter=Filter(must=[
            FieldCondition(key="metadata.user_id", match=MatchValue(value=user_id)),
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


async def event_stream(user_query, user_id) -> AsyncIterable[str]:
    try:
        conversation_handler = ConversationHandler()
        yield sse("status", {"type": "tag", "stage":"searching", "message": "Searching documents"})
        vector_searches = await run_in_threadpool(rag_search, user_query, user_id)
        yield sse('status', {"type": "tag", 'stage':'retrieved', 'message':'Document Retrieved'})
        yield sse('status', {"type": "tag", 'stage':'generating', 'message':'Generating response'})
        if not vector_searches:
            yield sse('status', {'stage':'done', 'message': 'No data found'})
            return
        full_text = ''
        async for text in llm_output(vector_searches, user_query):
            full_text += text
            yield sse("status", {'stage':'response', 'message': text})
        await conversation_handler.update_conversation(user_query, full_text, user_id)
        yield sse('status', {"type": "tag", 'stage': 'done', 'message':'Generated response'})
    except Exception as error:
        yield sse("status", {"stage":"error", "message": "Could not generate an answer."})

async def llm_output(context: str, input: str):
    try:
        langsmith_client = Client()
        chat_prompt = ChatPromptTemplate([
            ('system', 'You are helpful assistant'),
            ('human', 'here is the context {context} and user query \n {input} based on it respond accordingly')
        ])
        try:
            chat_prompt = langsmith_client.pull_prompt(PROMPT_TEMPLATE)
        except:
            langsmith_client.push_prompt(PROMPT_TEMPLATE,object=chat_prompt)

        send_email(type="rag_search", context=context[:50], input=input)
        model = GoogleGenerativeAI(model="gemini-3.5-flash-lite")
        parser = StrOutputParser()
        chain = chat_prompt | model | parser

        async for chunk in chain.astream({'context':context,'input':input}):
            if chunk:
                yield chunk
    except Exception as error:
        logger.exception("Error generating LLM response for user input=%r & error=%s", input, error)
        raise Exception("Error generating response")