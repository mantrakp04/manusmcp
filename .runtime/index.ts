import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as MCPTypes from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { FileService } from "./src/services/fileService";
import { ShellService } from "./src/services/shellService";
import { BrowserService } from "./src/services/browserService";

// Initialize services
const fileService = new FileService();
const shellService = new ShellService();
const browserService = new BrowserService();

// Create an MCP server
const server = new McpServer({
  name: "ManusMCP",
  version: "1.0.0"
});

// File operations
server.tool(
  "file_read",
  {
    file: z.string(),
    startLine: z.number().optional(),
    endLine: z.number().optional(),
    sudo: z.boolean().optional()
  },
  async ({ file, startLine, endLine, sudo }) => {
    const result = await fileService.readFile(file, startLine, endLine, sudo);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.tool(
  "file_write",
  {
    file: z.string(),
    content: z.string(),
    append: z.boolean().optional(),
    leadingNewline: z.boolean().optional(),
    trailingNewline: z.boolean().optional(),
    sudo: z.boolean().optional()
  },
  async ({ file, content, append, leadingNewline, trailingNewline, sudo }) => {
    const result = await fileService.writeFile(file, content, append, leadingNewline, trailingNewline, sudo);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.tool(
  "file_str_replace",
  {
    file: z.string(),
    oldStr: z.string(),
    newStr: z.string(),
    sudo: z.boolean().optional()
  },
  async ({ file, oldStr, newStr, sudo }) => {
    const result = await fileService.replaceInFile(file, oldStr, newStr, sudo);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.tool(
  "file_find_in_content",
  {
    file: z.string(),
    regex: z.string(),
    sudo: z.boolean().optional()
  },
  async ({ file, regex, sudo }) => {
    const result = await fileService.findInContent(file, regex, sudo);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.tool(
  "file_find_by_name",
  {
    path: z.string(),
    globPattern: z.string()
  },
  async ({ path, globPattern }) => {
    const result = await fileService.findByName(path, globPattern);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

// Shell operations
server.tool(
  "shell_exec",
  {
    id: z.string(),
    execDir: z.string().default("."),
    command: z.string()
  },
  async ({ id, execDir, command }) => {
    const result = await shellService.execCommand(id, execDir, command);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.tool(
  "shell_view",
  {
    id: z.string()
  },
  ({ id }) => {
    const result = shellService.viewSession(id);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.tool(
  "shell_wait",
  {
    id: z.string(),
    seconds: z.number().optional()
  },
  async ({ id, seconds }) => {
    const result = await shellService.waitForSession(id, seconds);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.tool(
  "shell_write_to_process",
  {
    id: z.string(),
    input: z.string(),
    pressEnter: z.boolean().optional()
  },
  async ({ id, input, pressEnter }) => {
    const result = await shellService.writeToProcess(id, input, pressEnter);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.tool(
  "shell_kill_process",
  {
    id: z.string()
  },
  async ({ id }) => {
    const result = await shellService.killProcess(id);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

// Browser operations

server.tool(
  "browser_view",
  {},
  async () => {
    const result = await browserService.view();
    const screenshot = result.screenshot?.toString('base64') || "";
    const parsedScreenshot = result.parsedScreenshot?.toString('base64') || "";
    const parsedText = result.parsedText || "";
    return MCPTypes.CallToolResultSchema.parse({
      content: [
        { type: "image", data: `data:image/png;base64,${screenshot}`},
        { type: "image", data: `data:image/png;base64,${parsedScreenshot}`},
        { type: "text", text: parsedText}
      ]
    })
  }
);

server.tool(
  "browser_navigate",
  {
    url: z.string()
  },
  async ({ url }) => {
    const result = await browserService.navigate(url);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.tool(
  "browser_click",
  {
    index: z.number().optional(),
    coordinateX: z.number().optional(),
    coordinateY: z.number().optional()
  },
  async ({ index, coordinateX, coordinateY }) => {
    const result = await browserService.click(index, coordinateX, coordinateY);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.tool(
  "browser_input",
  {
    text: z.string(),
    pressEnter: z.boolean(),
    index: z.number().optional(),
    coordinateX: z.number().optional(),
    coordinateY: z.number().optional()
  },
  async ({ text, pressEnter, index, coordinateX, coordinateY }) => {
    const result = await browserService.input(text, pressEnter, index, coordinateX, coordinateY);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.tool(
  "browser_move_mouse",
  {
    coordinateX: z.number(),
    coordinateY: z.number()
  },
  async ({ coordinateX, coordinateY }) => {
    const result = await browserService.moveMouse(coordinateX, coordinateY);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.tool(
  "browser_press_key",
  {
    key: z.string()
  },
  async ({ key }) => {
    const result = await browserService.pressKey(key);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.tool(
  "browser_select_option",
  {
    index: z.number(),
    option: z.number()
  },
  async ({ index, option }) => {
    const result = await browserService.selectOption(index, option);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.tool(
  "browser_scroll_up",
  {
    toTop: z.boolean().optional()
  },
  async ({ toTop }) => {
    const result = await browserService.scroll('up', toTop ?? false);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.tool(
  "browser_scroll_down",
  {
    toBottom: z.boolean().optional()
  },
  async ({ toBottom }) => {
    const result = await browserService.scroll('down', toBottom ?? false);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.tool(
  "browser_console_exec",
  {
    javascript: z.string()
  },
  async ({ javascript }) => {
    const result = await browserService.executeJavaScript(javascript);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.tool(
  "browser_console_view",
  {
    maxLines: z.number().optional()
  },
  ({ maxLines }) => {
    const result = browserService.viewConsoleLogs(maxLines);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

// Start receiving messages on stdin and sending messages on stdout
const transport = new StdioServerTransport();
await server.connect(transport);