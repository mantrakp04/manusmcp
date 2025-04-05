import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
// import { ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
// import { ChatAnthropic } from "@langchain/anthropic";
import { env } from "@/env";

// Configure with OpenAI (commented out as default to use Google's model)
export const model = new ChatOpenAI({
  model: "primary",
  temperature: 0.1,
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

// Configure with Google Generative AI
// export const model = new ChatGoogleGenerativeAI({
//   model: "gemini-2.0-flash",
//   apiKey: env.GOOGLE_API_KEY,
// });

// export const embeddings = new GoogleGenerativeAIEmbeddings({
//   model: "gemini-embedding-exp-03-07",
//   apiKey: env.GOOGLE_API_KEY,
// });

// export const model = new ChatAnthropic({
//   model: "claude-3-5-sonnet-latest",
//   apiKey: env.ANTHROPIC_API_KEY,
// });