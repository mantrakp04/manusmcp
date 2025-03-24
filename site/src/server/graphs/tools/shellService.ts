import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { spawn, exec } from "child_process";

// Shell sessions storage
const shellSessions: Record<string, {
  process: any;
  output: string[];
  running: boolean;
  cwd: string;
}> = {};

// Shell execute tool
export const shellExecTool = new DynamicStructuredTool({
  name: "shell_exec",
  description: "Execute commands in a specified shell session. Use for running code, installing packages, or managing files.",
  schema: z.object({
    id: z.string().describe("Unique identifier of the target shell session"),
    exec_dir: z.string().describe("Working directory for command execution (must use absolute path)"),
    command: z.string().describe("Shell command to execute")
  }),
  func: async ({ id, exec_dir, command }) => {
    try {
      // Create or get the shell session
      if (!shellSessions[id]) {
        shellSessions[id] = {
          process: null,
          output: [],
          running: false,
          cwd: exec_dir
        };
      }
      
      // If there's a process already running, kill it
      if (shellSessions[id].process && shellSessions[id].running) {
        try {
          shellSessions[id].process.kill();
        } catch (e) {
          // Ignore errors when killing process
        }
      }
      
      // Reset output for new command
      shellSessions[id].output = [];
      shellSessions[id].cwd = exec_dir;
      
      // Create promise to handle async execution
      return new Promise((resolve, reject) => {
        // Start the process
        const process = spawn(command, {
          shell: true,
          cwd: exec_dir
        });
        
        shellSessions[id]!.process = process;
        shellSessions[id]!.running = true;
        
        // Collect output
        process.stdout.on('data', (data) => {
          const text = data.toString();
          shellSessions[id]!.output.push(text);
        });
        
        process.stderr.on('data', (data) => {
          const text = data.toString();
          shellSessions[id]!.output.push(text);
        });
        
        // Handle process exit
        process.on('close', (code) => {
          shellSessions[id]!.running = false;
          
          // Get all output
          const output = shellSessions[id]!.output.join('');
          
          if (code === 0) {
            // Limit output to a reasonable size
            const outputPreview = output.length > 2000 
              ? output.slice(0, 2000) + '... (output truncated)'
              : output;
              
            resolve(`Command executed successfully in ${exec_dir}:\n\n${outputPreview}`);
          } else {
            resolve(`Command failed with code ${code}:\n\n${output}`);
          }
        });
        
        process.on('error', (error) => {
          shellSessions[id]!.running = false;
          resolve(`Failed to start command: ${error.message}`);
        });
      });
    } catch (error) {
      return `Error executing command: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
});

// Shell view tool
export const shellViewTool = new DynamicStructuredTool({
  name: "shell_view",
  description: "View the content of a specified shell session. Use for checking command execution results or monitoring output.",
  schema: z.object({
    id: z.string().describe("Unique identifier of the target shell session")
  }),
  func: async ({ id }) => {
    try {
      if (!shellSessions[id]) {
        return `No shell session found with ID: ${id}`;
      }
      
      const output = shellSessions[id]!.output.join('');
      const status = shellSessions[id]!.running ? 'RUNNING' : 'COMPLETED';
      const cwd = shellSessions[id]!.cwd;
      
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
export const shellWaitTool = new DynamicStructuredTool({
  name: "shell_wait",
  description: "Wait for the running process in a specified shell session to return. Use after running commands that require longer runtime.",
  schema: z.object({
    id: z.string().describe("Unique identifier of the target shell session"),
    seconds: z.number().int().optional().describe("Wait duration in seconds")
  }),
  func: async ({ id, seconds }) => {
    try {
      if (!shellSessions[id]) {
        return `No shell session found with ID: ${id}`;
      }
      
      if (!shellSessions[id].running) {
        return `Shell session ${id} is not running`;
      }
      
      const maxWaitTime = (seconds || 30) * 1000; // Default to 30 seconds
      const startTime = Date.now();
      
      // Create promise to handle async wait
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          // Check if the process is still running
          if (!shellSessions[id]!.running) {
            clearInterval(checkInterval);
            const output = shellSessions[id]!.output.join('');
            
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
export const shellWriteToProcessTool = new DynamicStructuredTool({
  name: "shell_write_to_process",
  description: "Write input to a running process in a specified shell session. Use for responding to interactive command prompts.",
  schema: z.object({
    id: z.string().describe("Unique identifier of the target shell session"),
    input: z.string().describe("Input content to write to the process"),
    press_enter: z.boolean().describe("Whether to press Enter key after input")
  }),
  func: async ({ id, input, press_enter }) => {
    try {
      if (!shellSessions[id]) {
        return `No shell session found with ID: ${id}`;
      }
      
      if (!shellSessions[id]!.running || !shellSessions[id]!.process) {
        return `No running process found in shell session ${id}`;
      }
      
      // Add newline if press_enter is true
      const inputText = press_enter ? input + '\n' : input;
      
      // Write to stdin of the process
      shellSessions[id]!.process.stdin.write(inputText);
      
      return `Input "${input}" written to process in shell session ${id}${press_enter ? ' with Enter key' : ''}`;
    } catch (error) {
      return `Error writing to process: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
});

// Shell kill process tool
export const shellKillProcessTool = new DynamicStructuredTool({
  name: "shell_kill_process",
  description: "Terminate a running process in a specified shell session. Use for stopping long-running processes or handling frozen commands.",
  schema: z.object({
    id: z.string().describe("Unique identifier of the target shell session")
  }),
  func: async ({ id }) => {
    try {
      if (!shellSessions[id]) {
        return `No shell session found with ID: ${id}`;
      }
      
      if (!shellSessions[id]!.running || !shellSessions[id]!.process) {
        return `No running process found in shell session ${id}`;
      }
      
      // Kill the process
      shellSessions[id]!.process.kill('SIGTERM');
      
      // Wait a moment to check if process terminated
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Force kill if still running
      if (shellSessions[id]!.running && shellSessions[id]!.process) {
        try {
          shellSessions[id]!.process.kill('SIGKILL');
        } catch (e) {
          // Ignore errors when killing process
        }
      }
      
      shellSessions[id]!.running = false;
      return `Process in shell session ${id} terminated`;
    } catch (error) {
      return `Error killing process: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
});

export const shellTools = [
  shellExecTool,
  shellViewTool,
  shellWaitTool,
  shellWriteToProcessTool,
  shellKillProcessTool
];
