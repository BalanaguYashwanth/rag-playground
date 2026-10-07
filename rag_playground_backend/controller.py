import os, logging
from functools import lru_cache
from threading import Lock
from langchain.chat_models import init_chat_model
from langchain_core.documents import Document
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_qdrant import QdrantVectorStore
from qdrant_client import QdrantClient
from qdrant_client.models import VectorParams, Distance, Filter, FieldCondition, MatchValue, PayloadSchemaType
from langchain_text_splitters import RecursiveCharacterTextSplitter
from dotenv import load_dotenv
load_dotenv()

logger = logging.getLogger(__name__)

EMBEDDINGS_COLLECTION_NAME = str(os.getenv('EMBEDDINGS_COLLECTION_NAME'))
QDRANT_API_URL = str(os.getenv('QDRANT_API_URL'))
QDRANT_API_KEY = str(os.getenv('QDRANT_API_KEY'))
GOOGLE_API_KEY = str(os.getenv('GOOGLE_API_KEY'))

client = QdrantClient(
    api_key=QDRANT_API_KEY,
    url=QDRANT_API_URL
)
build_lock = Lock()

@lru_cache(maxsize=1)
def get_embeddings():
    return HuggingFaceEmbeddings()

def main():
    print("Hello from rag-playground!")

def rag_steps():
    # Note - Question every implement & should try every thing like keyword search and other distances etc
    # Note - try batching, streaming

    # Step 1 - Get data from pdf/document or text 

    # Step 2 - Clean / remove unuse from text

    # Step 2 - Do the chunking

    # Step 3 - Keyword search

    # Step 4 - Embedding using sentence transformer

    # Step 5 - Vector search using generator / iterator, do the streaming
    pass


def create_rag(text: str, user_id: str, document_id: str, filename: str):
    with build_lock:
        documents = [Document(page_content=text, metadata={
            "user_id": user_id, "document_id": document_id, "source": filename,
        })]
        splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50) # What should be the ideal size of chunk ?
        chunks = splitter.split_documents(documents)

        embeddings_model = get_embeddings()
        if not client.collection_exists(EMBEDDINGS_COLLECTION_NAME):
            client.create_collection(
                collection_name=EMBEDDINGS_COLLECTION_NAME, 
                vectors_config=VectorParams(
                    size=len(embeddings_model.embed_query("dimension check")),
                    distance=Distance.COSINE
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

        for offset in range(0, len(chunks), 32):
            collection.add_documents(chunks[offset:offset + 32])

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

async def llm_output(context: str, input: str):
    try:
        #TODO: Resolve AFC message by re-implementing with chat prompt template with model check campusx video
        llm_model = init_chat_model("google_genai:gemini-3.5-flash-lite")
        prompt = f"system: you are helpful assistant and \n here is the context {context} and user query \n {input} based on it respond accordingly"
        async for chunk in llm_model.astream(prompt): # replace with prompt template and gemini chat completions and system
            content = getattr(chunk, "content", None)
            if isinstance(content, list) and chunk.content and isinstance(chunk.content[0], dict):
                if chunk.content[0].get('text'):
                    yield chunk.content[0].get('text')
    except Exception as error:
       logging.exception("Error generating LLM response for user input=%r & error=%s", input, error)
       raise Exception("Error generating response")