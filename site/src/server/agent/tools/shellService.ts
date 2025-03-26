import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { spawn, exec } from "child_process";

class ShellService {
  private sessionId: string;
  
  // Shell sessions storage
  private shellSessions: Record<string, {
    process: any;
    output: string[];
    running: boolean;
    cwd: string;
  }> = {};
  
  constructor(sessionId: string = 'default') {
    this.sessionId = sessionId;
  }
  
  // Internal function to get session-scoped shell ID
  private getSessionShellId(shellId: string): string {
    return `${this.sessionId}:${shellId}`;
  }

  // Shell execute tool
  shellExecTool = new DynamicStructuredTool({
    name: "shell_exec",
    description: "Execute commands in a specified shell session. Use for running code, installing packages, or managing files.",
    schema: z.object({
      id: z.string().describe("Unique identifier of the target shell session"),
      exec_dir: z.string().describe("Working directory for command execution (must use absolute path)"),
      command: z.string().describe("Shell command to execute")
    }),
    func: async ({ id, exec_dir, command }) => {
      try {
        const sessionShellId = this.getSessionShellId(id);
        
        // Create or get the shell session
        if (!this.shellSessions[sessionShellId]) {
          this.shellSessions[sessionShellId] = {
            process: null,
            output: [],
            running: false,
            cwd: exec_dir
          };
        }
        
        // If there's a process already running, kill it
        if (this.shellSessions[sessionShellId].process && this.shellSessions[sessionShellId].running) {
          try {
            this.shellSessions[sessionShellId].process.kill();
          } catch (e) {
            // Ignore errors when killing process
          }
        }
        
        // Reset output for new command
        this.shellSessions[sessionShellId].output = [];
        this.shellSessions[sessionShellId].cwd = exec_dir;
        
        // Create promise to handle async execution
        return new Promise((resolve, reject) => {
          // Start the process
          const process = spawn(command, {
            shell: true,
            cwd: exec_dir
          });
          
          this.shellSessions[sessionShellId]!.process = process;
          this.shellSessions[sessionShellId]!.running = true;
          
          // Collect output
          process.stdout.on('data', (data) => {
            const text = data.toString();
            this.shellSessions[sessionShellId]!.output.push(text);
          });
          
          process.stderr.on('data', (data) => {
            const text = data.toString();
            this.shellSessions[sessionShellId]!.output.push(text);
          });
          
          // Handle process exit
          process.on('close', (code) => {
            this.shellSessions[sessionShellId]!.running = false;
            
            // Get all output
            const output = this.shellSessions[sessionShellId]!.output.join('');
            
            if (code === 0) {
              // Limit output to a reasonable size
              const outputPreview = output.length > 20000 
                ? output.slice(0, 20000) + '... (output truncated)'
                : output;
                
              resolve(`Command executed successfully in ${exec_dir}:\n\n${outputPreview}`);
            } else {
              resolve(`Command failed with code ${code}:\n\n${output}`);
            }
          });
          
          process.on('error', (error) => {
            this.shellSessions[sessionShellId]!.running = false;
            resolve(`Failed to start command: ${error.message}`);
          });
        });
      } catch (error) {
        return `Error executing command: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  });

  // Shell view tool
  shellViewTool = new DynamicStructuredTool({
    name: "shell_view",
    description: "View the content of a specified shell session. Use for checking command execution results or monitoring output.",
    schema: z.object({
      id: z.string().describe("Unique identifier of the target shell session")
    }),
    func: async ({ id }) => {
      try {
        const sessionShellId = this.getSessionShellId(id);
        
        if (!this.shellSessions[sessionShellId]) {
          return `No shell session found with ID: ${id} in session ${this.sessionId}`;
        }
        
        const output = this.shellSessions[sessionShellId]!.output.join('');
        const status = this.shellSessions[sessionShellId]!.running ? 'RUNNING' : 'COMPLETED';
        const cwd = this.shellSessions[sessionShellId]!.cwd;
        
        if (output.length === 0) {
          return `Shell session ${id} [${status}] in ${cwd}:\n\n(No output)`;
        }
        
        // Limit output to a reasonable size
        const outputPreview = output.length > 5000 
          ? output.slice(0, 5000) + '... (output truncated)'
          : output;
          
        return `Shell session ${id} [${status}] in ${cwd}:\n\n${outputPreview}`;
      } catch (error) {
        return `Error viewing shell session: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  });

  // Shell wait tool
  shellWaitTool = new DynamicStructuredTool({
    name: "shell_wait",
    description: "Wait for the running process in a specified shell session to return. Use after running commands that require longer runtime.",
    schema: z.object({
      id: z.string().describe("Unique identifier of the target shell session"),
      seconds: z.number().int().optional().describe("Wait duration in seconds")
    }),
    func: async ({ id, seconds }) => {
      try {
        const sessionShellId = this.getSessionShellId(id);
        
        if (!this.shellSessions[sessionShellId]) {
          return `No shell session found with ID: ${id} in session ${this.sessionId}`;
        }
        
        if (!this.shellSessions[sessionShellId].running) {
          return `Shell session ${id} is not running`;
        }
        
        const maxWaitTime = (seconds || 30) * 1000; // Default to 30 seconds
        const startTime = Date.now();
        
        // Create promise to handle async wait
        return new Promise((resolve) => {
          const checkInterval = setInterval(() => {
            // Check if the process is still running
            if (!this.shellSessions[sessionShellId]!.running) {
              clearInterval(checkInterval);
              const output = this.shellSessions[sessionShellId]!.output.join('');
              
              // Limit output to a reasonable size
              const outputPreview = output.length > 2000 
                ? output.slice(0, 2000) + '... (output truncated)'
                : output;
                
              resolve(`Process in shell session ${id} completed:\n\n${outputPreview}`);
            }
            
            // Check if we've exceeded the wait time
            if (Date.now() - startTime > maxWaitTime) {
              clearInterval(checkInterval);
              resolve(`Wait timeout exceeded (${seconds || 30} seconds) for shell session ${id}. Process is still running.`);
            }
          }, 100); // Check every 100ms
        });
      } catch (error) {
        return `Error waiting for shell session: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  });

  // Shell write to process tool
  shellWriteToProcessTool = new DynamicStructuredTool({
    name: "shell_write_to_process",
    description: "Write input to a running process in a specified shell session. Use for responding to interactive command prompts.",
    schema: z.object({
      id: z.string().describe("Unique identifier of the target shell session"),
      input: z.string().describe("Input content to write to the process"),
      press_enter: z.boolean().describe("Whether to press Enter key after input")
    }),
    func: async ({ id, input, press_enter }) => {
      try {
        const sessionShellId = this.getSessionShellId(id);
        
        if (!this.shellSessions[sessionShellId]) {
          return `No shell session found with ID: ${id} in session ${this.sessionId}`;
        }
        
        if (!this.shellSessions[sessionShellId]!.running || !this.shellSessions[sessionShellId]!.process) {
          return `No running process found in shell session ${id}`;
        }
        
        // Add newline if press_enter is true
        const inputText = press_enter ? input + '\n' : input;
        
        // Write to stdin of the process
        this.shellSessions[sessionShellId]!.process.stdin.write(inputText);
        
        return `Input "${input}" written to process in shell session ${id}${press_enter ? ' with Enter key' : ''}`;
      } catch (error) {
        return `Error writing to process: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  });

  // Shell kill process tool
  shellKillProcessTool = new DynamicStructuredTool({
    name: "shell_kill_process",
    description: "Terminate a running process in a specified shell session. Use for stopping long-running processes or handling frozen commands.",
    schema: z.object({
      id: z.string().describe("Unique identifier of the target shell session")
    }),
    func: async ({ id }) => {
      try {
        const sessionShellId = this.getSessionShellId(id);
        
        if (!this.shellSessions[sessionShellId]) {
          return `No shell session found with ID: ${id} in session ${this.sessionId}`;
        }
        
        if (!this.shellSessions[sessionShellId]!.running || !this.shellSessions[sessionShellId]!.process) {
          return `No running process found in shell session ${id}`;
        }
        
        // Kill the process
        this.shellSessions[sessionShellId]!.process.kill('SIGTERM');
        
        // Wait a moment to check if process terminated
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Force kill if still running
        if (this.shellSessions[sessionShellId]!.running && this.shellSessions[sessionShellId]!.process) {
          try {
            this.shellSessions[sessionShellId]!.process.kill('SIGKILL');
          } catch (e) {
            // Ignore errors when killing process
          }
        }
        
        this.shellSessions[sessionShellId]!.running = false;
        return `Process in shell session ${id} terminated`;
      } catch (error) {
        return `Error killing process: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  });

  get shellTools() {
    return [
      this.shellExecTool,
      this.shellViewTool,
      this.shellWaitTool,
      this.shellWriteToProcessTool,
      this.shellKillProcessTool
    ];
  }

  // Cleanup shell sessions for this service instance
  async cleanup(): Promise<void> {
    const sessionShellIds = Object.keys(this.shellSessions);
    
    for (const sessionShellId of sessionShellIds) {
      const session = this.shellSessions[sessionShellId]!;
      if (session.process && session.running) {
        try {
          session.process.kill('SIGKILL');
        } catch (e) {
          // Ignore errors when killing process
        }
      }
    }
    
    // Clear the sessions object
    this.shellSessions = {};
  }
}

export default ShellService;
