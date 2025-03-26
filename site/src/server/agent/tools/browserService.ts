import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { chromium, type Browser, type Page } from "playwright";
import { solve } from "recaptcha-solver";
import { Client } from "@gradio/client";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

import { env } from "@/env";

const omniParserClient = new Client(env.GRADIO_OMNI_PARSER_V2_CLIENT);

// Type definitions for the evaluate functions
interface ElementInfo {
  tag: string;
  id: string;
  class: string;
  text: string;
}


class BrowserManager {
  private static instance: BrowserManager;
  private browsers: Map<string, {
    browser: Browser | null;
    page: Page | null;
    consoleLog: string[];
  }> = new Map();
  
  private constructor() {}
  
  public static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
  }
  
  async getBrowser(sessionId: string): Promise<Browser> {
    if (!this.browsers.has(sessionId)) {
      this.browsers.set(sessionId, {
        browser: null,
        page: null,
        consoleLog: []
      });
    }
    
    const session = this.browsers.get(sessionId)!;
    
    if (!session.browser) {
      session.browser = await chromium.launch({
        headless: false,
        args: ['--disable-web-security', '--disable-features=IsolateOrigins,site-per-process']
      });
    }
    
    return session.browser;
  }
  
  async getPage(sessionId: string): Promise<Page> {
    if (!this.browsers.has(sessionId)) {
      this.browsers.set(sessionId, {
        browser: null,
        page: null,
        consoleLog: []
      });
    }
    
    const session = this.browsers.get(sessionId)!;
    
    if (!session.page) {
      const browser = await this.getBrowser(sessionId);
      session.page = await browser.newPage();
      
      // Set up console logging
      session.page.on('console', message => {
        const text = `[${message.type()}] ${message.text()}`;
        session.consoleLog.push(text);
        // Keep log size manageable
        if (session.consoleLog.length > 1000) {
          session.consoleLog.shift();
        }
      });
    }
    
    return session.page;
  }
  
  getConsoleLog(sessionId: string, maxLines?: number): string[] {
    if (!this.browsers.has(sessionId)) {
      return [];
    }
    
    const session = this.browsers.get(sessionId)!;
    
    if (!maxLines) return [...session.consoleLog];
    return session.consoleLog.slice(-maxLines);
  }
  
  async restart(sessionId: string): Promise<void> {
    if (!this.browsers.has(sessionId)) {
      return;
    }
    
    const session = this.browsers.get(sessionId)!;
    
    try {
      if (session.page) {
        await session.page.close();
        session.page = null;
      }
      
      if (session.browser) {
        await session.browser.close();
        session.browser = null;
      }
      
      session.consoleLog = [];
    } catch (error) {
      console.error(`Error restarting browser for session ${sessionId}:`, error);
    }
  }

  async captureAndParseScreenshot(sessionId: string): Promise<{
    screenshot: Buffer,
    parsedScreenshot?: Buffer,
    parsedText?: string
  }> {
    if (!this.browsers.has(sessionId)) {
      throw new Error(`Browser session not initialized for session ${sessionId}`);
    }
    
    const session = this.browsers.get(sessionId)!;
    
    if (!session.page) {
      throw new Error(`Browser page not initialized for session ${sessionId}`);
    }

    // Take screenshot
    const screenshotBuffer = await session.page.screenshot();
    
    // Create a temporary file to store the screenshot
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `screenshot-${sessionId}-${Date.now()}.png`);
    await fs.writeFile(tempFilePath, screenshotBuffer);
    
    try {
      // Use OmniParser to extract text from the screenshot
      const result = await omniParserClient.predict(
        "/process", 
        [
          tempFilePath,  // image_input
          0.05,          // box_threshold
          0.1,           // iou_threshold
          true,          // use_paddleocr
          640            // imgsz
        ]
      );
      
      // Extract the parsed text from the result
      let parsedScreenshotBuffer: Buffer | undefined = undefined;
      let parsedText: string | undefined = undefined;
      if (Array.isArray(result.data) && result.data.length > 1) {
        parsedScreenshotBuffer = result.data[0];
        parsedText = result.data[1];
      }
      
      // Clean up the temporary file
      await fs.unlink(tempFilePath);
      
      return {
        screenshot: screenshotBuffer,
        parsedScreenshot: parsedScreenshotBuffer,
        parsedText: parsedText
      };
    } catch (error) {
      // Clean up the temporary file
      try {
        await fs.unlink(tempFilePath);
      } catch (e) {
        // Ignore errors when deleting temp file
      }
      
      console.error(`Error parsing screenshot for session ${sessionId}:`, error);
      return {
        screenshot: screenshotBuffer
      };
    }
  }
}

class BrowserService {
  private sessionId: string;
  
  constructor(sessionId: string = 'default') {
    this.sessionId = sessionId;
  }
  
  // Browser view tool
  browserViewTool = new DynamicStructuredTool({
    name: "browser_view",
    description: "View content of the current browser page. Use for checking the latest state of previously opened pages.",
    schema: z.object({
      includeText: z.boolean().optional().describe("(Optional) Whether to include extracted text in the response. Defaults to true.")
    }),
    func: async ({ includeText = true }) => {
      try {
        const manager = BrowserManager.getInstance();
        const { screenshot, parsedScreenshot, parsedText } = await manager.captureAndParseScreenshot(this.sessionId);
        const response: { type: string; image?: string; text?: string }[] = [
          {
            type: "image",
            image: `data:image/png;base64,${screenshot.toString('base64')}`
          },
          {
            type: "image",
            image: `data:image/png;base64,${parsedScreenshot?.toString('base64')}`
          },
        ];
        if (includeText) {
          response.push({
            type: "text",
            text: parsedText || "No text found"
          });
        }
        return response;
      } catch (error) {
        return `Error viewing browser page: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  });

  // Browser navigate tool
  browserNavigateTool = new DynamicStructuredTool({
    name: "browser_navigate",
    description: "Navigate browser to specified URL. Use when accessing new pages is needed.",
    schema: z.object({
      url: z.string().describe("Complete URL to visit. Must include protocol prefix.")
    }),
    func: async ({ url }) => {
      try {
        // Ensure URL has a protocol
        let finalUrl = url;
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          finalUrl = 'https://' + url;
        }
        
        const manager = BrowserManager.getInstance();
        const page = await manager.getPage(this.sessionId);
        
        // Navigate with timeout and wait until network is idle
        await page.goto(finalUrl, { 
          timeout: 30000,
          waitUntil: 'networkidle' 
        });

        await solve(page)
        
        const title = await page.title();
        
        return `Successfully navigated to ${finalUrl} - Page title: ${title}`;
      } catch (error) {
        return `Error navigating to URL: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  });

  // Browser restart tool
  browserRestartTool = new DynamicStructuredTool({
    name: "browser_restart",
    description: "Restart browser and navigate to specified URL. Use when browser state needs to be reset.",
    schema: z.object({
      url: z.string().describe("Complete URL to visit after restart. Must include protocol prefix.")
    }),
    func: async ({ url }) => {
      try {
        // Ensure URL has a protocol
        let finalUrl = url;
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          finalUrl = 'https://' + url;
        }
        
        const manager = BrowserManager.getInstance();
        await manager.restart(this.sessionId);
        
        // Get a new page
        const page = await manager.getPage(this.sessionId);
        
        // Navigate with timeout and wait until network is idle
        await page.goto(finalUrl, { 
          timeout: 30000,
          waitUntil: 'networkidle' 
        });
        
        await solve(page)
        
        const title = await page.title();
        
        return `Successfully restarted browser and navigated to ${finalUrl} - Page title: ${title}`;
      } catch (error) {
        return `Error restarting browser: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  });

  // Browser click tool
  browserClickTool = new DynamicStructuredTool({
    name: "browser_click",
    description: "Click on elements in the current browser page. Use when clicking page elements is needed.",
    schema: z.object({
      index: z.number().int().optional().describe("(Optional) Index number of the element to click"),
      coordinate_x: z.number().optional().describe("(Optional) X coordinate of click position"),
      coordinate_y: z.number().optional().describe("(Optional) Y coordinate of click position")
    }),
    func: async ({ index, coordinate_x, coordinate_y }) => {
      try {
        const manager = BrowserManager.getInstance();
        const page = await manager.getPage(this.sessionId);
        
        if (index !== undefined) {
          // Click by element index
          const elementExists = await page.evaluate((idx) => {
            const elements = Array.from(document.querySelectorAll('button, a, input, select, textarea'));
            return idx >= 0 && idx < elements.length;
          }, index);
          
          if (!elementExists) {
            return `No element found with index ${index}`;
          }
          
          await page.evaluate((idx) => {
            const elements = Array.from(document.querySelectorAll('button, a, input, select, textarea'));
            const element = elements[idx] as HTMLElement;
            element.click();
          }, index);
          
          // Wait for any navigation or network activity to settle
          try {
            await page.waitForLoadState('networkidle', { timeout: 5000 });
          } catch (e) {
            // Ignore timeout errors - some clicks don't trigger navigation
          }
          
          return `Clicked element with index ${index}`;
        } else if (coordinate_x !== undefined && coordinate_y !== undefined) {
          // Click by coordinates
          await page.mouse.click(coordinate_x, coordinate_y);
          
          // Wait for any navigation or network activity to settle
          try {
            await page.waitForLoadState('networkidle', { timeout: 5000 });
          } catch (e) {
            // Ignore timeout errors - some clicks don't trigger navigation
          }
          
          return `Clicked at coordinates (${coordinate_x}, ${coordinate_y})`;
        } else {
          return "Error: Either element index or coordinates must be provided";
        }
      } catch (error) {
        return `Error clicking element: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  });

  // Browser input tool
  browserInputTool = new DynamicStructuredTool({
    name: "browser_input",
    description: "Overwrite text in editable elements on the current browser page. Use when filling content in input fields.",
    schema: z.object({
      index: z.number().int().optional().describe("(Optional) Index number of the element to overwrite text"),
      coordinate_x: z.number().optional().describe("(Optional) X coordinate of the element to overwrite text"),
      coordinate_y: z.number().optional().describe("(Optional) Y coordinate of the element to overwrite text"),
      text: z.string().describe("Complete text content to overwrite"),
      press_enter: z.boolean().describe("Whether to press Enter key after input")
    }),
    func: async ({ index, coordinate_x, coordinate_y, text, press_enter }) => {
      try {
        const manager = BrowserManager.getInstance();
        const page = await manager.getPage(this.sessionId);
        
        if (index !== undefined) {
          // Input by element index
          const isValidInput = await page.evaluate((idx) => {
            const elements = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]'));
            return idx >= 0 && idx < elements.length;
          }, index);
          
          if (!isValidInput) {
            return `No input element found with index ${index}`;
          }
          
          await page.evaluate(({ idx, inputText }) => {
            const elements = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]'));
            const element = elements[idx] as HTMLElement;
            
            if (element.tagName.toLowerCase() === 'input' || element.tagName.toLowerCase() === 'textarea') {
              (element as HTMLInputElement).value = inputText;
              // Dispatch input and change events
              element.dispatchEvent(new Event('input', { bubbles: true }));
              element.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
              // For contenteditable elements
              element.innerText = inputText;
              element.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }, { idx: index, inputText: text });
          
          if (press_enter) {
            await page.keyboard.press('Enter');
            
            // Wait for any navigation or network activity to settle
            try {
              await page.waitForLoadState('networkidle', { timeout: 5000 });
            } catch (e) {
              // Ignore timeout errors
            }
          }
          
          return `Entered text "${text}" into element with index ${index}${press_enter ? ' and pressed Enter' : ''}`;
        } else if (coordinate_x !== undefined && coordinate_y !== undefined) {
          // Input by coordinates - first click at the coordinates
          await page.mouse.click(coordinate_x, coordinate_y);
          
          // Then clear existing content and type new text
          await page.keyboard.down('Control');
          await page.keyboard.press('a');
          await page.keyboard.up('Control');
          await page.keyboard.press('Backspace');
          
          await page.keyboard.type(text);
          
          if (press_enter) {
            await page.keyboard.press('Enter');
            
            // Wait for any navigation or network activity to settle
            try {
              await page.waitForLoadState('networkidle', { timeout: 5000 });
            } catch (e) {
              // Ignore timeout errors
            }
          }
          
          return `Entered text "${text}" at coordinates (${coordinate_x}, ${coordinate_y})${press_enter ? ' and pressed Enter' : ''}`;
        } else {
          return "Error: Either element index or coordinates must be provided";
        }
      } catch (error) {
        return `Error inputting text: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  });

  // Browser move mouse tool
  browserMoveMouseTool = new DynamicStructuredTool({
    name: "browser_move_mouse",
    description: "Move cursor to specified position on the current browser page. Use when simulating user mouse movement.",
    schema: z.object({
      coordinate_x: z.number().describe("X coordinate of target cursor position"),
      coordinate_y: z.number().describe("Y coordinate of target cursor position")
    }),
    func: async ({ coordinate_x, coordinate_y }) => {
      try {
        const manager = BrowserManager.getInstance();
        const page = await manager.getPage(this.sessionId);
        
        await page.mouse.move(coordinate_x, coordinate_y);
        
        // Get element at this position
        const elementInfo = await page.evaluate(({ x, y }) => {
          const element = document.elementFromPoint(x, y);
          if (!element) return null;
          
          return {
            tag: element.tagName.toLowerCase(),
            id: element.id || '',
            class: element.className || '',
            text: (element.textContent || '').trim().substring(0, 50)
          };
        }, { x: coordinate_x, y: coordinate_y });
        
        if (elementInfo as ElementInfo) {
          const typedInfo = elementInfo as ElementInfo;
          return `Moved mouse to coordinates (${coordinate_x}, ${coordinate_y}). Element at position: <${typedInfo?.tag}${typedInfo?.id ? ` id="${typedInfo.id}"` : ''}> ${typedInfo?.text}`;
        } else {
          return `Moved mouse to coordinates (${coordinate_x}, ${coordinate_y}). No element found at this position.`;
        }
      } catch (error) {
        return `Error moving mouse: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  });

  // Browser press key tool
  browserPressKeyTool = new DynamicStructuredTool({
    name: "browser_press_key",
    description: "Simulate key press in the current browser page. Use when specific keyboard operations are needed.",
    schema: z.object({
      key: z.string().describe("Key name to simulate (e.g., Enter, Tab, ArrowUp), supports key combinations (e.g., Control+Enter).")
    }),
    func: async ({ key }) => {
      try {
        const manager = BrowserManager.getInstance();
        const page = await manager.getPage(this.sessionId);
        
        if (key.includes('+')) {
          // Handle key combinations like Control+Enter or Shift+Tab
          const parts = key.split('+').map(k => k.trim());
          const modifiers = parts.slice(0, -1);
          const mainKey = parts[parts.length - 1];
          
          // Press all modifiers
          for (const modifier of modifiers) {
            await page.keyboard.down(modifier);
          }
          
          // Press and release the main key
          await page.keyboard.press(mainKey || '');
          
          // Release all modifiers
          for (const modifier of modifiers) {
            await page.keyboard.up(modifier);
          }
        } else {
          // Simple key press
          await page.keyboard.press(key);
        }
        
        // Wait for any navigation or network activity to settle
        try {
          await page.waitForLoadState('networkidle', { timeout: 3000 });
        } catch (e) {
          // Ignore timeout errors - not all key presses cause navigation
        }
        
        return `Pressed key: ${key}`;
      } catch (error) {
        return `Error pressing key: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  });

  // Browser select option tool
  browserSelectOptionTool = new DynamicStructuredTool({
    name: "browser_select_option",
    description: "Select specified option from dropdown list element in the current browser page. Use when selecting dropdown menu options.",
    schema: z.object({
      index: z.number().int().describe("Index number of the dropdown list element"),
      option: z.number().int().describe("Option number to select, starting from 0.")
    }),
    func: async ({ index, option }) => {
      try {
        const manager = BrowserManager.getInstance();
        const page = await manager.getPage(this.sessionId);
        
        // Check if the dropdown exists
        const selectExists = await page.evaluate((idx) => {
          const selects = Array.from(document.querySelectorAll('select'));
          return idx >= 0 && idx < selects.length;
        }, index);
        
        if (!selectExists) {
          return `No dropdown element found with index ${index}`;
        }
        
        // Check if the option exists
        const optionExists = await page.evaluate(({ idx, opt }) => {
          const selects = Array.from(document.querySelectorAll('select'));
          const select = selects[idx] as HTMLSelectElement;
          return opt >= 0 && opt < select.options.length;
        }, { idx: index, opt: option });
        
        if (!optionExists) {
          return `Option ${option} does not exist in dropdown with index ${index}`;
        }
        
        // Get option value before selecting
        const optionInfo = await page.evaluate(({ idx, opt }) => {
          const selects = Array.from(document.querySelectorAll('select'));
          const select = selects[idx] as HTMLSelectElement;
          const option = select.options[opt];
          if (!option) return { text: "Unknown", value: "" };
          return {
            text: option.text,
            value: option.value
          };
        }, { idx: index, opt: option });
        
        // Select the option
        await page.evaluate(({ idx, opt }) => {
          const selects = Array.from(document.querySelectorAll('select'));
          const select = selects[idx] as HTMLSelectElement;
          select.selectedIndex = opt;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }, { idx: index, opt: option });
        
        // Wait for any resulting navigation or network activity
        try {
          await page.waitForLoadState('networkidle', { timeout: 3000 });
        } catch (e) {
          // Ignore timeout errors
        }
        
        return `Selected option ${option} (${optionInfo.text}) from dropdown with index ${index}`;
      } catch (error) {
        return `Error selecting option: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  });

  // Browser scroll up tool
  browserScrollUpTool = new DynamicStructuredTool({
    name: "browser_scroll_up",
    description: "Scroll up the current browser page. Use when viewing content above or returning to page top.",
    schema: z.object({
      to_top: z.boolean().optional().describe("(Optional) Whether to scroll directly to page top instead of one viewport up.")
    }),
    func: async ({ to_top }) => {
      try {
        const manager = BrowserManager.getInstance();
        const page = await manager.getPage(this.sessionId);
        
        if (to_top) {
          // Scroll to top
          await page.evaluate(() => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          });
          
          return "Scrolled to the top of the page";
        } else {
          // Get viewport height and scroll up one viewport
          const viewportHeight = await page.evaluate(() => {
            const oldScrollTop = window.scrollY;
            const viewportHeight = window.innerHeight;
            window.scrollBy({ top: -viewportHeight, behavior: 'smooth' });
            
            // Return how far we actually scrolled
            return {
              viewportHeight,
              scrolled: oldScrollTop - window.scrollY
            };
          });
          
          return `Scrolled up by ${viewportHeight.scrolled} pixels (one viewport)`;
        }
      } catch (error) {
        return `Error scrolling up: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  });

  // Browser scroll down tool
  browserScrollDownTool = new DynamicStructuredTool({
    name: "browser_scroll_down",
    description: "Scroll down the current browser page. Use when viewing content below or jumping to page bottom.",
    schema: z.object({
      to_bottom: z.boolean().optional().describe("(Optional) Whether to scroll directly to page bottom instead of one viewport down.")
    }),
    func: async ({ to_bottom }) => {
      try {
        const manager = BrowserManager.getInstance();
        const page = await manager.getPage(this.sessionId);
        
        if (to_bottom) {
          // Scroll to bottom
          await page.evaluate(() => {
            window.scrollTo({ 
              top: document.documentElement.scrollHeight,
              behavior: 'smooth' 
            });
          });
          
          return "Scrolled to the bottom of the page";
        } else {
          // Get viewport height and scroll down one viewport
          const viewportInfo = await page.evaluate(() => {
            const oldScrollTop = window.scrollY;
            const viewportHeight = window.innerHeight;
            window.scrollBy({ top: viewportHeight, behavior: 'smooth' });
            
            // Return how far we actually scrolled
            return {
              viewportHeight,
              scrolled: window.scrollY - oldScrollTop
            };
          });
          
          return `Scrolled down by ${viewportInfo.scrolled} pixels (one viewport)`;
        }
      } catch (error) {
        return `Error scrolling down: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  });

  // Browser console execute tool
  browserConsoleExecTool = new DynamicStructuredTool({
    name: "browser_console_exec",
    description: "Execute JavaScript code in browser console. Use when custom scripts need to be executed.",
    schema: z.object({
      javascript: z.string().describe("JavaScript code to execute. Note that the runtime environment is browser console.")
    }),
    func: async ({ javascript }) => {
      try {
        const manager = BrowserManager.getInstance();
        const page = await manager.getPage(this.sessionId);
        
        // Execute the JavaScript in the page context
        const result = await page.evaluate((code) => {
          try {
            // Use Function constructor to execute code in global scope
            return new Function(`return (async () => { 
              try { 
                return { result: await (${code}) }; 
              } catch (error) { 
                return { error: error.message }; 
              }
            })()`)();
          } catch (error) {
            if (error instanceof Error) {
              return { error: error.message };
            }
            return { error: String(error) };
          }
        }, javascript);
        
        if (result.error) {
          return `Error executing JavaScript: ${result.error}`;
        }
        
        // Format the result for better readability
        let formattedResult;
        try {
          if (result.result === undefined) {
            formattedResult = "undefined";
          } else if (result.result === null) {
            formattedResult = "null";
          } else {
            formattedResult = JSON.stringify(result.result, null, 2);
          }
        } catch (e) {
          formattedResult = `[Object] (Cannot stringify result: ${e instanceof Error ? e.message : String(e)})`;
        }
        
        return `JavaScript executed successfully. Result:\n${formattedResult}`;
      } catch (error) {
        return `Error executing JavaScript: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  });

  // Browser console view tool
  browserConsoleViewTool = new DynamicStructuredTool({
    name: "browser_console_view",
    description: "View browser console output. Use when checking JavaScript logs or debugging page errors.",
    schema: z.object({
      max_lines: z.number().int().optional().describe("(Optional) Maximum number of log lines to return.")
    }),
    func: async ({ max_lines }) => {
      try {
        const manager = BrowserManager.getInstance();
        const log = manager.getConsoleLog(this.sessionId, max_lines);
        
        if (log.length === 0) {
          return "No console output available";
        }
        
        return `Browser console output (${log.length} lines):\n\n${log.join('\n')}`;
      } catch (error) {
        return `Error viewing console: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  });

  get browserTools() {
    return [
      this.browserViewTool,
      this.browserNavigateTool,
      this.browserRestartTool,
      this.browserClickTool,
      this.browserInputTool,
      this.browserMoveMouseTool,
      this.browserPressKeyTool,
      this.browserSelectOptionTool,
      this.browserScrollUpTool,
      this.browserScrollDownTool,
      this.browserConsoleExecTool,
      this.browserConsoleViewTool
    ];
  }
}

export default BrowserService;
