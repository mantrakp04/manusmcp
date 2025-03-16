import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { glob } from 'glob';
import type { FileOperationResult } from '../types';

const execAsync = promisify(exec);

export class FileService {
    async readFile(
        file: string,
        startLine?: number,
        endLine?: number,
        sudo: boolean = false
    ): Promise<FileOperationResult> {
        try {
            let content: string;
            if (sudo) {
                const { stdout } = await execAsync(`sudo cat ${file}`);
                content = stdout;
            } else {
                content = await fs.readFile(file, 'utf-8');
            }

            if (startLine !== undefined || endLine !== undefined) {
                const lines = content.split('\n');
                const start = startLine ?? 0;
                const end = endLine ?? lines.length;
                content = lines.slice(start, end).join('\n');
            }

            return { content };
        } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
        }
    }

    async writeFile(
        file: string,
        content: string,
        append: boolean = false,
        leadingNewline: boolean = false,
        trailingNewline: boolean = false,
        sudo: boolean = false
    ): Promise<FileOperationResult> {
        try {
            let finalContent = content;
            if (leadingNewline) finalContent = '\n' + finalContent;
            if (trailingNewline) finalContent = finalContent + '\n';

            if (sudo) {
                const mode = append ? '>>' : '>';
                await execAsync(`sudo bash -c "echo '${finalContent}' ${mode} ${file}"`);
            } else {
                const flag = append ? 'a' : 'w';
                await fs.writeFile(file, finalContent, { flag });
            }

            return { success: true };
        } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
        }
    }

    async replaceInFile(
        file: string,
        oldStr: string,
        newStr: string,
        sudo: boolean = false
    ): Promise<FileOperationResult> {
        try {
            let content: string;
            if (sudo) {
                const { stdout } = await execAsync(`sudo cat ${file}`);
                content = stdout;
            } else {
                content = await fs.readFile(file, 'utf-8');
            }

            const modifiedContent = content.replace(oldStr, newStr);

            if (sudo) {
                await execAsync(`sudo bash -c "cat > ${file} << 'EOF'\n${modifiedContent}\nEOF"`);
            } else {
                await fs.writeFile(file, modifiedContent);
            }

            return { success: true };
        } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
        }
    }

    async findInContent(
        file: string,
        regex: string,
        sudo: boolean = false
    ): Promise<FileOperationResult> {
        try {
            let content: string;
            if (sudo) {
                const { stdout } = await execAsync(`sudo cat ${file}`);
                content = stdout;
            } else {
                content = await fs.readFile(file, 'utf-8');
            }

            const pattern = new RegExp(regex);
            const matches = content.split('\n').map((line, i) => {
                const matches: Array<{
                    lineNumber: number;
                    line: string;
                    match: string;
                    start: number;
                    end: number;
                }> = [];
                let match;
                while ((match = pattern.exec(line)) !== null) {
                    matches.push({
                        lineNumber: i,
                        line,
                        match: match[0],
                        start: match.index,
                        end: match.index + match[0].length
                    });
                }
                return matches;
            }).flat();

            return { matches };
        } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
        }
    }

    async findByName(path: string, globPattern: string): Promise<FileOperationResult> {
        try {
            const files = await glob(globPattern, { cwd: path });
            return { files };
        } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
        }
    }
} 