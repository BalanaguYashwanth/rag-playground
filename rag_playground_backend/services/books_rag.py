from langchain_core.documents import Document
from langchain_qdrant import QdrantVectorStore
from langchain_text_splitters import RecursiveCharacterTextSplitter
from qdrant_client import QdrantClient
from qdrant_client.models import VectorParams, Distance
from langchain_huggingface import HuggingFaceEmbeddings

qdrant_client = QdrantClient(
    url="",
    api_key=""
)

collection_name = "books_rag"

def get_embedding():
    return HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2") # sentence-transformers/all-MiniLM-L6-v2

if not qdrant_client.collection_exists(collection_name):
    embedding_model = get_embedding()
    qdrant_client.create_collection(
        collection_name=collection_name,
        vectors_config=VectorParams(
            size=len(embedding_model.embed_query("dimension_check")),
            distance=Distance.EUCLID
        )
    )

vector_store = QdrantVectorStore(
    qdrant_client,
    collection_name=collection_name,
    embedding=get_embedding(),
    distance=Distance.EUCLID
)

def rag_build():
    text = """
    Indian Americans are Americans whose ancestry originates wholly or partly from India. The terms Asian Indian and East Indian are used to avoid confusion with Native Americans in the United States, who are also referred to as "Indians" or "American Indians". With a population of more than 6 million (6,079,221) according to the Indian Ministry of External Affairs,[11] Indian Americans are the largest group of South Asian Americans, the largest Asian-alone group when excluding multiracial people,[12] and the second-largest group of Asian Americans after Chinese Americans. The United States hosts the largest Indian diaspora by population, though not by percentage.
    The Indian American population started increasing after the 1980s, when U.S. migration policies started to attract highly skilled and educated Indian immigrants.[13] Indian Americans have the highest median household income and the second highest per capita income (after Taiwanese Americans) among other ethnic groups working in the United States.[14] "Indian" does not refer to a single ethnic group, but is used as an umbrella term for the various ethnic groups in India."
    """
    splitter = RecursiveCharacterTextSplitter(chunk_size=100, chunk_overlap=50)
    chunks = splitter.split_text(text)
    vector_store.add_documents([Document(page_content=chunk) for chunk in chunks])
rag_build()
def rag_search():
    search_responses = vector_store.similarity_search(query="in which year indians american population is increasing ?")
    for data in search_responses:
        print('\n---data--', data.page_content)
rag_search()