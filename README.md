# ManusMCP

An AI agent framework using Flowise to deploy AI team members with specialized capabilities.

**Note**: Tested with Anthropic models only. [Reason](https://x.com/barre_of_lube/status/1901661792667103351)

## What is ManusMCP?

ManusMCP is a framework for orchestrating specialized AI agents that work together to accomplish complex tasks. The Model Context Protocol (MCP) enables these agents to collaborate effectively by providing a shared context and communication layer.

## Installation

```bash
# Clone the repository
git clone https://github.com/mantrakp04/manusmcp.git
cd manusmcp/pytools

# Install dependencies
npm i -g bun
bash flowise.sh
```

## Usage

### 1: Run it with docker

```bash
cp .env.example .env
docker-compose up -d
```

### 2: Open Flowise

1. Open Flowise UI in your [browser](http://localhost:8001)
2. Go to "Agentflows" section
3. Click on "Add New" (Top Right)
4. Click Settings (Top Right)
5. Click Import and select the v2.2 and save it
6. Create a new flow, (FROM STEP 2)
7. Use v2.3 as the flow file

### [Optional] Checkout the MCP Server

```bash
cd pytools
bunx @modelcontextprotocol/inspector uv run manusmcp
```

Recommended runtime: [`bun`](https://bun.sh/)

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
