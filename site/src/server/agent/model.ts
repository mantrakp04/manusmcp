import "dotenv/config";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";

// export const model = new ChatOpenAI({
//   model: "primary",
//   temperature: 0.7,
//   configuration: {
//     baseURL: "http://localhost:4000",
//   },
//   apiKey: "hello_world"
// });

// export const embeddings = new OpenAIEmbeddings({
//   model: "embeddings",
//   apiKey: "hello_world",
//   configuration: {
//     baseURL: "http://localhost:4000",
//   },
// });
export const model = new ChatGoogleGenerativeAI({
  model: "gemini-2.0-flash",
  apiKey: "AIzaSyCmWs3sXsax6pHTthLqcKZS_pzPqHfbMDA",
});

export const embeddings = new GoogleGenerativeAIEmbeddings({
  model: "gemini-embedding-exp-03-07",
  apiKey: "AIzaSyCmWs3sXsax6pHTthLqcKZS_pzPqHfbMDA",
});

