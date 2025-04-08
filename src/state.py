from langchain_core.messages import BaseMessage
from typing_extensions import TypedDict, Annotated
from typing import List
from langgraph.graph import END

class Step(TypedDict):
  description: str
  substeps: list[str]

class State(TypedDict):
    input: Annotated[str, {
      "reducer": lambda x, y: y if y is not None else x, 
      "default": lambda: ""
    }]
    plan: Annotated[List[Step], {
      "reducer": lambda x, y: x + y, 
      "default": lambda: []
    }]
    pastSteps: Annotated[list[dict[str, any]], {
      "reducer": lambda x, y: x + y, 
      "default": lambda: []
    }]
    response: Annotated[str, {
      "reducer": lambda x, y: y if y is not None else x, 
      "default": lambda: ""
    }]
    sources: Annotated[list[str], {
      "reducer": lambda x, y: y if y is not None else x if x is not None else [], 
      "default": lambda: []
    }]
    messages: Annotated[list[BaseMessage], {
      "reducer": lambda x, y: x + y, 
      "default": lambda: []
    }]
    next: Annotated[str, {
      "reducer": lambda x, y: y if y is not None else x if x is not None else END, 
      "default": lambda: END
    }]
    instruction: Annotated[str, {
      "reducer": lambda x, y: y if y is not None else x if x is not None else "", 
      "default": lambda: ""
    }]
