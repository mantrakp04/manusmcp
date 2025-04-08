from langgraph.graph import END, StateGraph, START
from langchain_core.messages import HumanMessage
from langchain_core.runnables import RunnableConfig
from langgraph.types import Command, interrupt

from src.model import model
from src.model_types import members, Router
from src.state import State
from src.prompts import supervisor_prompt
from src.workers import browser_worker, fs_worker, kb_worker, shell_worker

def supervisor(state: State, config: RunnableConfig | None = None) -> State:
  task = state["plan"][0]
  supervisor = supervisor_prompt | model.with_structured_output(Router)
  output = supervisor.invoke({"messages": [
    HumanMessage(f"""
Based on this information, which worker should handle this task?
Respond with one of: {members} or FINISH if complete.
Provide detailed instructions for the selected worker.
Task: {task.description}""" +
"\nSubsteps: " + "\n".join(task.substeps)
  )]}, config)
  
  goto = output.next
  if goto == "FINISH":
    return Command(goto=END, update={
      "plan": state["plan"][1:],
      "pastSteps": [{
        "step": task.description,
        "result": str(state["messages"][-1].content)
      }]
    })
  return Command(goto=goto, update={
    "next": goto,
    "instruction": output.instruction
  })

def ask_user(state: State, config: RunnableConfig | None = None) -> State:
  human_message = interrupt("human_input")
  return {
    "messages": [
      {
        "role": "human",
        "content": human_message
      }
    ]
  }

sub_workflow = StateGraph(State)
sub_workflow.add_node("ask_user", ask_user)
sub_workflow.add_node("supervisor", supervisor)
sub_workflow.add_node("browser_worker", browser_worker)
sub_workflow.add_node("fs_worker", fs_worker)
sub_workflow.add_node("kb_worker", kb_worker)
sub_workflow.add_node("shell_worker", shell_worker)

for worker in members:
  sub_workflow.add_edge(worker, "supervisor")

sub_workflow.add_edge(START, "supervisor")
