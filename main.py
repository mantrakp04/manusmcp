from src import get_app_with_checkpointer
import uuid
import asyncio
import traceback
from litellm.exceptions import BadRequestError

async def main():
  try:
    input = "deep analyze the current stock market situation"
    app = await get_app_with_checkpointer()
    result = app.astream_events({ "input": input }, version="v2", config={ "configurable": { "thread_id": "123" + str(uuid.uuid4()) }, "recursion_limit": 100 })
    async for event in result:
      kind = event.get("event", "unknown")
      name = event.get("name", "")
      if kind != "on_chat_model_stream":  # Skip printing for this event kind
        log_msg = f"{kind}: {name}"
        print(log_msg)
  except BadRequestError as e:
    print(f"LiteLLM API Error: {e}")
    print("Check your API key and model configuration in .env and src/model.py")
  except Exception as e:
    print(f"An unexpected error occurred: {e}")
    traceback.print_exc()

if __name__ == "__main__":
  asyncio.run(main())
