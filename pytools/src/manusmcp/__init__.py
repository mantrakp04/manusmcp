import os
import subprocess

from fastapi import FastAPI

from .tools import mcp, sessions, ShellSession
from . import config

def main():
    mcp.run(transport="sse")

if __name__ == "__main__":
    main()