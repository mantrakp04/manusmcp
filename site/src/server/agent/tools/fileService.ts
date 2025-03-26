import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { glob } from "glob";
import { execSync } from "child_process";
import mime from "mime";

class FileService {
  private sessionId: string;
  
  constructor(sessionId: string = 'default') {
    this.sessionId = sessionId;
  }
  
  // File read tool
  fileReadTool = new DynamicStructuredTool({
    name: "file_read",
    description: "Read file content. Use for checking file contents, analyzing logs, or reading configuration files.",
    schema: z.object({
      file: z.string().describe("Absolute path of the file to read"),
      start_line: z.number().int().optional().describe("(Optional) Starting line to read from, 0-based"),
      end_line: z.number().int().optional().describe("(Optional) Ending line number (exclusive)"),
      sudo: z.boolean().optional().describe("(Optional) Whether to use sudo privileges")
    }),
    func: async ({ file, start_line, end_line, sudo }) => {
      try {
        let content;
        
        if (sudo) {
          // Use sudo to read the file
          content = execSync(`sudo cat "${file}"`).toString();
        } else {
          content = await fs.readFile(file, 'utf-8');
        }
        
        if (start_line !== undefined || end_line !== undefined) {
          const lines = content.split('\n');
          const startIdx = start_line || 0;
          const endIdx = end_line !== undefined ? end_line : lines.length;
          content = lines.slice(startIdx, endIdx).join('\n');
        }
        
        return content;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return `Error reading file: ${errorMessage}`;
      }
    }
  });

  // File read image tool has been removed since mime is missing
  fileReadImageTool = new DynamicStructuredTool({
    name: "file_read_image",
    description: "Read image file content. Use for analyzing images or extracting metadata.",
    schema: z.object({  
      file: z.string().describe("Absolute path of the image file to read")
    }),
    func: async ({ file }) => {
      try {
        const content = await fs.readFile(file);
        return [{
          type: "image",
          content: `data:${mime.getType(file)};base64,${content.toString('base64')}`
        }];
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return `Error reading image file: ${errorMessage}`;
      }
    }
  });

  // File write tool
  fileWriteTool = new DynamicStructuredTool({
    name: "file_write",
    description: "Overwrite or append content to a file. Use for creating new files, appending content, or modifying existing files.",
    schema: z.object({
      file: z.string().describe("Absolute path of the file to write to"),
      content: z.string().describe("Text content to write"),
      append: z.boolean().optional().describe("(Optional) Whether to use append mode"),
      leading_newline: z.boolean().optional().describe("(Optional) Whether to add a leading newline"),
      trailing_newline: z.boolean().optional().describe("(Optional) Whether to add a trailing newline"),
      sudo: z.boolean().optional().describe("(Optional) Whether to use sudo privileges")
    }),
    func: async ({ file, content, append, leading_newline, trailing_newline, sudo }) => {
      try {
        // Prepare content with optional newlines
        let finalContent = content;
        if (leading_newline) finalContent = '\n' + finalContent;
        if (trailing_newline) finalContent = finalContent + '\n';
        
        // Create directory if it doesn't exist
        const dir = path.dirname(file);
        if (!existsSync(dir)) {
          await fs.mkdir(dir, { recursive: true });
        }
        
        if (sudo) {
          // Use a temporary file and sudo to move it
          const tempFile = `/tmp/file_write_${this.sessionId}_${Date.now()}.tmp`;
          await fs.writeFile(tempFile, finalContent, 'utf-8');
          
          if (append) {
            execSync(`sudo bash -c "cat '${tempFile}' >> '${file}'"`);
          } else {
            execSync(`sudo mv '${tempFile}' '${file}'`);
          }
          
          // Clean up the temp file if it wasn't moved
          if (existsSync(tempFile)) {
            await fs.unlink(tempFile);
          }
        } else {
          const flags = append ? 'a' : 'w';
          await fs.writeFile(file, finalContent, { flag: flags });
        }
        
        const mode = append ? "appended to" : "written to";
        return `Content successfully ${mode} ${file}`;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return `Error writing to file: ${errorMessage}`;
      }
    }
  });

  // File string replace tool
  fileStrReplaceTool = new DynamicStructuredTool({
    name: "file_str_replace",
    description: "Replace specified string in a file. Use for updating specific content in files or fixing errors in code.",
    schema: z.object({
      file: z.string().describe("Absolute path of the file to perform replacement on"),
      old_str: z.string().describe("Original string to be replaced"),
      new_str: z.string().describe("New string to replace with"),
      sudo: z.boolean().optional().describe("(Optional) Whether to use sudo privileges")
    }),
    func: async ({ file, old_str, new_str, sudo }) => {
      try {
        let content;
        
        if (sudo) {
          content = execSync(`sudo cat '${file}'`).toString();
        } else {
          content = await fs.readFile(file, 'utf-8');
        }
        
        // Perform the replacement
        const updatedContent = content.replace(new RegExp(old_str, 'g'), new_str);
        
        // Check if any replacements were made
        if (content === updatedContent) {
          return `No occurrences of "${old_str}" found in ${file}`;
        }
        
        // Write the updated content back to the file
        if (sudo) {
          const tempFile = `/tmp/file_replace_${this.sessionId}_${Date.now()}.tmp`;
          await fs.writeFile(tempFile, updatedContent, 'utf-8');
          execSync(`sudo mv '${tempFile}' '${file}'`);
        } else {
          await fs.writeFile(file, updatedContent, 'utf-8');
        }
        
        return `Replaced all occurrences of "${old_str}" with "${new_str}" in ${file}`;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return `Error replacing string in file: ${errorMessage}`;
      }
    }
  });

  // File find in content tool
  fileFindInContentTool = new DynamicStructuredTool({
    name: "file_find_in_content",
    description: "Search for matching text within file content. Use for finding specific content or patterns in files.",
    schema: z.object({
      file: z.string().describe("Absolute path of the file to search within"),
      regex: z.string().describe("Regular expression pattern to match"),
      sudo: z.boolean().optional().describe("(Optional) Whether to use sudo privileges")
    }),
    func: async ({ file, regex, sudo }) => {
      try {
        let content;
        
        if (sudo) {
          content = execSync(`sudo cat '${file}'`).toString();
        } else {
          content = await fs.readFile(file, 'utf-8');
        }
        
        const lines = content.split('\n');
        const matches = [];
        
        try {
          const pattern = new RegExp(regex, 'g');
          
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i] || '';
            if (pattern.test(line)) {
              matches.push({ lineNumber: i + 1, content: line.trim() });
              pattern.lastIndex = 0; // Reset regex state
            }
          }
          
          if (matches.length === 0) {
            return `No matches found for pattern "${regex}" in ${file}`;
          }
          
          return matches.map(m => `Line ${m.lineNumber}: ${m.content}`).join('\n');
        } catch (regexError) {
          return `Invalid regex pattern: ${regex}`;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return `Error searching in file: ${errorMessage}`;
      }
    }
  });

  // File find by name tool
  fileFindByNameTool = new DynamicStructuredTool({
    name: "file_find_by_name",
    description: "Find files by name pattern in specified directory. Use for locating files with specific naming patterns.",
    schema: z.object({
      path: z.string().describe("Absolute path of directory to search"),
      glob: z.string().describe("Filename pattern using glob syntax wildcards")
    }),
    func: async ({ path: searchPath, glob: pattern }) => {
      try {
        if (!existsSync(searchPath)) {
          return `Directory does not exist: ${searchPath}`;
        }
        
        const files = await glob(`${searchPath}/${pattern}`, { nodir: false });
        
        if (files.length === 0) {
          return `No files matching pattern "${pattern}" found in ${searchPath}`;
        }
        
        return files.join('\n');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return `Error finding files: ${errorMessage}`;
      }
    }
  });

  get fileTools() {
    return [
      this.fileReadTool,
      this.fileWriteTool,
      this.fileStrReplaceTool,
      this.fileFindInContentTool,
      this.fileFindByNameTool
    ];
  }
}

export default FileService;
