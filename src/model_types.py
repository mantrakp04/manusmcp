from typing import List, Literal, Union

from pydantic import BaseModel, Field

class Step(BaseModel):
  description: str = Field(description="A description of the step")
  substeps: List[str] = Field(description="1-4 substeps that break down how to accomplish this step, depending on the complexity of the step.")

class Plan(BaseModel):
  steps: List[Step] = Field(description="A list of high-level sequential steps with detailed expansions")

class Response(BaseModel):
  response: str = Field(description="A response to the user")

class RePlanAct(BaseException):
  action: Union[Plan, Response] = Field(description="Action to perform. If you want to respond to user, use Response. " +
                                        "If you need to further use tools to get the answer, use Plan.")

members = ["fs_worker", "shell_worker", "browser_worker", "kb_worker", "ask_user"]
options = members + ["FINISH"]

class Router(BaseModel):
  next: Literal["fs_worker", "shell_worker", "browser_worker", "kb_worker", "ask_user", "FINISH"]
  instruction: str = Field(description="Instructions for the next worker")