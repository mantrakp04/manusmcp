import aiosqlite

from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langchain_core.runnables import RunnableConfig
from dotenv import load_dotenv

from src.model import model
from src.state import State
from src.prompts import *
from src.model_types import Plan, RePlanAct, Response
from src.supervisor import sub_workflow as supervisor

load_dotenv()

def plan_step(state: State, config: RunnableConfig | None = None) -> State:
  planner = planner_prompt | model.with_structured_output(Plan)
  output = planner.invoke({"input": state["input"]}, config)
  return { "plan": output.steps }

def replan_step(state: State, config: RunnableConfig | None = None) -> State:
  replanner = replanner_prompt | model.with_structured_output(RePlanAct)
  output = replanner.invoke({
    "input": state["input"],
    "plan": "\n\n".join(
        f"{i+1}. {step.description}\n" + 
        "\n".join(f"   {chr(97 + j)}. {substep}" for j, substep in enumerate(step.substeps))
        for i, step in enumerate(state["plan"])
    ),
    "pastSteps": "\n".join(f"{step['step']}: {step['result']}" for step in state["pastSteps"]),
  }, config)
  if isinstance(output.action, Response):
    return { "response": output.action.response }
  else:
    return { "plan": output.action.steps }

def should_end(state: State):
  if "response" in state and state["response"]:
    return END
  else:
    return "supervisor"

workflow = StateGraph(State)
workflow.add_node("planner", plan_step)
workflow.add_node("supervisor", supervisor.compile())
workflow.add_node("replanner", replan_step)
workflow.add_edge(START, "planner")
workflow.add_edge("planner", "supervisor")
workflow.add_edge("supervisor", "replanner")
workflow.add_conditional_edges("replanner", should_end, ["supervisor", END])

async def get_app_with_checkpointer():
  conn = await aiosqlite.connect("checkpoints.sqlite")
  checkpointer = AsyncSqliteSaver(conn)
  return workflow.compile(checkpointer=checkpointer)
