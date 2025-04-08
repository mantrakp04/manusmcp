import os
from langchain_litellm.chat_models import ChatLiteLLM
from langchain_openai import OpenAIEmbeddings

model = ChatLiteLLM(
    model="openrouter/anthropic/claude-3-5-haiku",
    temperature=0.3,
    api_key=os.getenv("OPENROUTER_API_KEY")
)

embeddings = OpenAIEmbeddings(
    model="Definity/granite-embedding-278m-multilingual-Q8_0:latest",
    api_key="hi",
    base_url="http://localhost:11434/v1"
)