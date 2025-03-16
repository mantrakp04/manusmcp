# ManusMCP

A TypeScript implementation of a Model Context Protocol (MCP) server with file, shell, and browser automation capabilities.

## Features

- File Operations
  - Read and write files
  - Search file contents
  - Find files by pattern
  - Replace text in files
  - Support for sudo operations

- Shell Operations
  - Execute commands
  - Manage shell sessions
  - Write to running processes
  - Monitor command output
  - Kill processes

- Browser Automation
  - Navigate web pages
  - Click elements
  - Input text
  - Mouse movement
  - Keyboard input
  - Select options
  - Scroll pages
  - Execute JavaScript
  - Monitor console logs

## Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   bun install
   ```

## Usage

Start the MCP server:

```bash
bun run index.ts
```

The server will start listening on stdin/stdout for MCP protocol messages.

## Development

The project is structured as follows:

- `src/services/`: Core service implementations
  - `fileService.ts`: File operations
  - `shellService.ts`: Shell command execution
  - `browserService.ts`: Browser automation

- `src/types/`: TypeScript type definitions

## Dependencies

- `@modelcontextprotocol/sdk`: MCP protocol implementation
- `playwright`: Browser automation
- `glob`: File pattern matching
- `zod`: Runtime type checking

## License

MIT
