# ManusMCP

An AI agent framework using Flowise to deploy AI team members with specialized capabilities.

**Note**: Tested with Anthropic models only. [Reason](https://x.com/barre_of_lube/status/1901661792667103351)

## What is ManusMCP?

ManusMCP is a framework for orchestrating specialized AI agents that work together to accomplish complex tasks. The Model Context Protocol (MCP) enables these agents to collaborate effectively by providing a shared context and communication layer.

## Installation

```bash
# Clone the repository
git clone https://github.com/mantrakp04/manusmcp.git
cd manusmcp/.runtime

# Install dependencies
bun i # install bun with npm i -g bun
cd ..
```

## Usage

### Option 1: Manual setup with Flowise

1. Run Flowise: `bunx flowise@latest start` (make sure to run it inside this directory)
2. Open Flowise UI in your browser (default: <http://localhost:3000>)
3. Go to "Agentflows" section
4. Click Settings (Top Right)
5. Click Import and select the agent flow configuration file

~~### Option 2: Run locally with script~~ WIP

```bash
bash start.sh
```

~~### Option 3: Run in Docker~~ WIP

```bash
bash start.sh --docker
```

### MCP Server

```bash
cd .runtime
bunx @modelcontextprotocol/inspector bun index.ts
```

### Unstructured API

```bash
docker-compose up -d
```

Recommended runtime: [`bun`](https://bun.sh/)

## Project Structure

- `.runtime/` - Contains the Model Context Protocol server implementation

## Agent Members

ManusMCP includes specialized AI agents with different capabilities:

### Planner

Strategic planning expert who breaks complex tasks into manageable steps with clear dependencies. Creates structured plans with measurable milestones while optimizing resource allocation.

```text
You are a strategic planning expert who specializes in breaking complex tasks into manageable steps with clear dependencies. Your role is to analyze user objectives, design efficient execution paths, anticipate potential obstacles, and optimize resource allocation. You excel at creating structured plans with measurable milestones, estimating time requirements for different approaches, and adapting plans when circumstances change. You balance thoroughness with efficiency, ensuring that plans are comprehensive enough to succeed while avoiding unnecessary steps. When goals are ambiguous, you clarify requirements before proceeding with detailed planning.
```

### FileWizard

File system expert for manipulating and organizing digital content. Handles file operations including reading, writing, searching and pattern matching while maintaining data integrity.

```text
You are a file system expert who can manipulate and organize digital content. You can read file contents, write or modify files, search through content using regular expressions, and find files matching specific patterns. Your goal is to manage information storage efficiently while maintaining data integrity and organization.
```

### CommandRunner

Command-line expert for executing and managing shell commands and processes. Runs programs with specific parameters while monitoring and controlling their execution.

```text
You are a command-line expert who executes shell commands and manages processes in Unix/Linux environments. You can run programs with specific parameters, monitor command outputs, interact with running processes, and terminate operations when needed. Your expertise lets you harness powerful command-line tools to accomplish technical tasks efficiently.
```

### WebNavigator

Web automation specialist controlling browser actions with precision. Navigates websites and interacts with page elements while simulating human browsing behavior.

```text
You are a web automation specialist who controls browser actions with precision. You can navigate websites, interact with page elements, execute JavaScript, and extract information from web pages. Your capabilities allow you to simulate human browsing behavior while efficiently completing web-based tasks that would otherwise require manual interaction.
```

## Contributing

This project is currently in development with initial working functionality. Here are the core components that could benefit from community contributions:

- **Prompts**: Help refine the AI agent prompts for more effective interactions
- **Workflows**: Enhance the workflow definitions in `Agents.json`
- **MCP Server**: Improve the Model Context Protocol server implementation in `.runtime/index.ts`

To contribute:

1. Fork the repository
2. Create a feature branch
3. Submit a pull request with your changes

## Sources

- [Huggingface discord post](https://discord.com/channels/879548962464493619/1348836305223815200)

## Disclaimer

Currently testing in main branch.
