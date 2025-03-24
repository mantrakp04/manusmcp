import "dotenv/config";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";

export const model = new ChatOpenAI({
  model: "primary",
  temperature: 0.7,
  configuration: {
    baseURL: "http://localhost:4000",
  },
  apiKey: "hello_world"
});

export const embeddings = new OpenAIEmbeddings({
  model: "embeddings",
  apiKey: "hello_world",
  configuration: {
    baseURL: "http://localhost:4000",
  },
});