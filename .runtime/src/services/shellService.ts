import { spawn, ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import type { ShellSession, ShellOperationResult } from '../types';

export class ShellService {
    private sessions: Map<string, ShellSession> = new Map();
    private nextJSRuntimeAttached: boolean = false;
    private nextJSSessionId: string | null = null;
    private useLinter: boolean = false;

    async execCommand(
        id: string,
        execDir: string,
        command: string
    ): Promise<ShellOperationResult> {
        try {
            // Create working directory if it doesn't exist
            await fs.mkdir(execDir, { recursive: true });

            // Start a new process
            const process = spawn(command, {
                shell: true,
                cwd: execDir,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            // Store session info
            const session: ShellSession = {
                process,
                output: [],
                command,
                execDir,
                running: true
            };

            this.sessions.set(id, session);

            // Set up output handling
            process.stdout?.on('data', (data) => {
                session.output.push(data.toString());
            });

            process.stderr?.on('data', (data) => {
                session.output.push(data.toString());
            });

            process.on('close', (code) => {
                session.running = false;
                session.returnCode = code ?? undefined;
            });

            return {
                success: true,
                sessionId: id,
                pid: process.pid
            };
        } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
        }
    }

    viewSession(id: string): ShellOperationResult {
        const session = this.sessions.get(id);
        if (!session) {
            return { error: `Shell session with ID '${id}' not found` };
        }

        const result: ShellOperationResult = {
            output: session.output.join(''),
            command: session.command,
            execDir: session.execDir,
            running: session.running
        };

        if (!session.running && session.returnCode !== undefined) {
            result.returnCode = session.returnCode;
        }

        return result;
    }

    async waitForSession(
        id: string,
        seconds?: number
    ): Promise<ShellOperationResult> {
        const session = this.sessions.get(id);
        if (!session) {
            return { error: `Shell session with ID '${id}' not found` };
        }

        if (!session.running) {
            return {
                alreadyCompleted: true,
                returnCode: session.returnCode,
                output: session.output.join('')
            };
        }

        try {
            if (seconds !== undefined) {
                await new Promise<void>((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error('Timeout'));
                    }, seconds * 1000);

                    session.process.on('close', () => {
                        clearTimeout(timeout);
                        resolve();
                    });
                });
            } else {
                await new Promise<void>((resolve) => {
                    session.process.on('close', resolve);
                });
            }

            return {
                completed: !session.running,
                returnCode: session.returnCode,
                output: session.output.join('')
            };
        } catch (e) {
            if (e instanceof Error && e.message === 'Timeout') {
                return {
                    timeout: true,
                    running: true,
                    partialOutput: session.output.join('')
                };
            }
            return { error: e instanceof Error ? e.message : String(e) };
        }
    }

    async writeToProcess(
        id: string,
        input: string,
        pressEnter: boolean = true
    ): Promise<ShellOperationResult> {
        const session = this.sessions.get(id);
        if (!session) {
            return { error: `Shell session with ID '${id}' not found` };
        }

        if (!session.running) {
            return { error: 'Process is not running' };
        }

        try {
            const finalInput = pressEnter ? input + '\n' : input;
            session.process.stdin?.write(finalInput);
            return { success: true };
        } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
        }
    }

    async killProcess(id: string): Promise<ShellOperationResult> {
        const session = this.sessions.get(id);
        if (!session) {
            return { error: `Shell session with ID '${id}' not found` };
        }

        if (!session.running) {
            return { message: 'Process is already terminated' };
        }

        try {
            // Try to terminate gracefully first
            session.process.kill('SIGTERM');

            // Give it some time to terminate
            try {
                await new Promise<void>((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('Timeout')), 3000);
                    session.process.on('close', () => {
                        clearTimeout(timeout);
                        resolve();
                    });
                });
            } catch {
                // If it doesn't terminate, kill it forcefully
                session.process.kill('SIGKILL');
                await new Promise<void>((resolve) => {
                    session.process.on('close', resolve);
                });
            }

            return {
                success: true,
                returnCode: session.returnCode,
                output: session.output.join('')
            };
        } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
        }
    }

    async attachNextJSRuntime(useLinter: boolean = false): Promise<ShellOperationResult> {
        try {
            const sourceDir = './.runtime/templates/nextjs';
            const targetDir = './';
            const sessionId = `nextjs-${Date.now()}`;

            // Store NextJS runtime state
            this.nextJSRuntimeAttached = true;
            this.nextJSSessionId = sessionId;
            this.useLinter = useLinter;

            // Check if source directory exists
            try {
                await fs.access(sourceDir);
            } catch (e) {
                return { error: `Template directory not found: ${sourceDir}` };
            }

            // Copy template directory recursively if package.json doesn't exist
            if (!(await fs.exists(path.join(targetDir, 'package.json')))) {
                await this.copyDirectory(sourceDir, targetDir);
                await this.execCommand(sessionId, targetDir, 'bun i && bun run dev')
            }

            // Create shell session to run bun commands
            return {
                message: "NextJS runtime attached. It comes pre-configured with shadcn/ui and framer-motion & uses bun as the package manager.\n" +
                "## General Instructions\n" +
                "- Always up-to-date with the latest technologies and best practices.\n" +
                "- Default to Next.js App Router" +
                "- Use the app/artifacts route to present structured, formatted content in a more visually appealing and organized way.\n" +
                "   Artifacts are particularly useful for:\n" +
                "   - Longer creative writing (stories, scripts, essays, etc.)\n" +
                "   - Analytical content like reviews or critiques\n" +
                "   - Custom code solutions to specific problems\n" +
                "   - Content you might want to use outside our conversation\n" +
                "   - Structured documents with multiple sections\n" +
                "   - Visualizations of data or concepts\n"
                ,
                sessionId: sessionId
            };
        } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
        }
    }

    // Helper method to recursively copy a directory
    private async copyDirectory(source: string, target: string): Promise<void> {
        // Create target directory if it doesn't exist
        await fs.mkdir(target, { recursive: true });
        
        // Read source directory
        const entries = await fs.readdir(source, { withFileTypes: true });
        
        // Process each entry
        for (const entry of entries) {
            const srcPath = path.join(source, entry.name);
            const destPath = path.join(target, entry.name);
            
            if (entry.isDirectory()) {
                // Recursively copy subdirectories
                await this.copyDirectory(srcPath, destPath);
            } else {
                // Copy files
                await fs.copyFile(srcPath, destPath);
            }
        }
    }

    // Add method to run linter
    async runLinter(): Promise<ShellOperationResult> {
        if (!this.nextJSRuntimeAttached || !this.nextJSSessionId || !this.useLinter) {
            return { success: false, message: "NextJS runtime not attached or linter not enabled" };
        }

        try {
            // Create a new session ID for linting
            const lintSessionId = `lint-${Date.now()}`;
            
            // Run the lint command
            const result = await this.execCommand(lintSessionId, './', 'bun run lint');
            
            // Wait for linting to complete
            const lintResult = await this.waitForSession(lintSessionId);
            
            return {
                success: true,
                lintOutput: lintResult.output,
                lintReturnCode: lintResult.returnCode
            };
        } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
        }
    }

    // Add getter to check NextJS runtime status
    isNextJSRuntimeAttached(): boolean {
        return this.nextJSRuntimeAttached;
    }

    // Add getter to check if linter is enabled
    isLinterEnabled(): boolean {
        return this.useLinter;
    }
}