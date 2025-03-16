import { spawn, ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import type { ShellSession, ShellOperationResult } from '../types';

export class ShellService {
    private sessions: Map<string, ShellSession> = new Map();

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
} 