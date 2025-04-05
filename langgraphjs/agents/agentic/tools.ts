import { MultiServerMCPClient } from '@langchain/mcp-adapters';

const client = new MultiServerMCPClient();
await client.connectToServerViaStdio('mcp-server', 'uv', ['run', '--project', 'mcp', 'manusmcp']);
const tools = await client.getTools();

const shellTools = ["shell_exec", "shell_view", "shell_wait", "shell_write_to_process", "shell_kill_process"]
const fsTools = ["file_read", "file_read_image", "file_write", "file_str_replace", "file_find_in_content", "file_find_by_name"]
const browserTools = ["browser_view", "browser_navigate", "browser_restart", "browser_click", "browser_input", "browser_move_mouse", "browser_press_key", "browser_select_option", "browser_scroll_up", "browser_scroll_down", "browser_console_exec", "browser_console_view"]

const shellToolkit = tools.filter(tool => shellTools.includes(tool.name));
const fsToolkit = tools.filter(tool => fsTools.includes(tool.name));
const browserToolkit = tools.filter(tool => browserTools.includes(tool.name));

// Session Manager to handle thread-specific tool instances
class SessionManager {
  private sessions: Map<string, {
    browser: { browserTools: typeof browserToolkit },
    shell: { shellTools: typeof shellToolkit },
    file: { fileTools: typeof fsToolkit }
  }> = new Map();

  constructor() {}

  getSessionServices(threadId: string) {
    if (!this.sessions.has(threadId)) {
      this.initializeSession(threadId);
    }
    return this.sessions.get(threadId)!;
  }

  private initializeSession(threadId: string) {
    this.sessions.set(threadId, {
      browser: { browserTools: browserToolkit },
      shell: { shellTools: shellToolkit },
      file: { fileTools: fsToolkit }
    });
  }

  async clearSession(threadId: string): Promise<void> {
    this.sessions.delete(threadId);
  }
}

const sessionManager = new SessionManager();

export { shellToolkit, fsToolkit, browserToolkit, sessionManager }
