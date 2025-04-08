from langgraph.prebuilt import create_react_agent
from langchain_core.messages import HumanMessage, AIMessage
from langchain_core.runnables import RunnableConfig

from src.state import State
from src.tools import browser_toolkit
from src.prompts import browser_prompt
from src.model import model

def browser_worker(state: State, config: RunnableConfig | None = None) -> State:
  agent = create_react_agent(model, tools=browser_toolkit, prompt=browser_prompt)
  output = agent.invoke({"messages": [HumanMessage(state["instruction"])]}, config)
  
  return {
    "messages": [
      output["messages"][-1]
    ]
  }