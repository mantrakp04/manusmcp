import { chromium } from 'playwright';
import type { ConsoleMessage } from 'playwright';
import type { BrowserInstance, BrowserOperationResult } from '../types';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { Client } from '@gradio/client';

export class BrowserService {
    private instance: BrowserInstance = {
        browser: null,
        context: null,
        page: null,
        consoleLogs: []
    };
    private client: Promise<Client>;

    constructor() {
        this.client = Client.connect("ginigen/OmniParser-v2-pro");
    }

    async ensureBrowser(): Promise<void> {
        if (!this.instance.browser) {
            this.instance.browser = await chromium.launch();
            this.instance.context = await this.instance.browser.newContext();
            this.instance.page = await this.instance.context.newPage();

            // Set up console log listener
            this.instance.consoleLogs = [];
            this.instance.page.on('console', (msg: ConsoleMessage) => {
                this.instance.consoleLogs.push(`${msg.type()}: ${msg.text()}`);
            });
        }
    }

    async closeBrowser(): Promise<void> {
        if (this.instance.page) {
            await this.instance.page.close();
            this.instance.page = null;
        }

        if (this.instance.context) {
            await this.instance.context.close();
            this.instance.context = null;
        }

        if (this.instance.browser) {
            await this.instance.browser.close();
            this.instance.browser = null;
        }
    }

    async navigate(url: string): Promise<BrowserOperationResult> {
        try {
            await this.ensureBrowser();
            if (!this.instance.page) {
                throw new Error('Browser page not initialized');
            }

            const response = await this.instance.page.goto(url, { waitUntil: 'networkidle' });
            const title = await this.instance.page.title();

            return {
                success: true,
                title,
                url: this.instance.page.url(),
                status: response?.status()
            };
        } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
        }
    }

    async click(
        index?: number,
        coordinateX?: number,
        coordinateY?: number
    ): Promise<BrowserOperationResult> {
        try {
            await this.ensureBrowser();
            if (!this.instance.page) {
                throw new Error('Browser page not initialized');
            }

            if (coordinateX !== undefined && coordinateY !== undefined) {
                await this.instance.page.mouse.click(coordinateX, coordinateY);
                await this.instance.page.waitForLoadState('networkidle');

                return {
                    success: true,
                    clickedBy: 'coordinates',
                    coordinates: { x: coordinateX, y: coordinateY }
                };
            }

            if (index !== undefined) {
                const clickableElements = await this.instance.page.$$('a, button, input[type="submit"], input[type="button"], [role="button"], [onclick]');

                if (index < 0 || index >= clickableElements.length) {
                    return { error: `Index ${index} out of range. Only ${clickableElements.length} clickable elements found.` };
                }

                await clickableElements[index].click();
                await this.instance.page.waitForLoadState('networkidle');

                return {
                    success: true,
                    clickedBy: 'index',
                    index
                };
            }

            return { error: 'Either index or coordinates (x,y) must be provided' };
        } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
        }
    }

    async input(
        text: string,
        pressEnter: boolean,
        index?: number,
        coordinateX?: number,
        coordinateY?: number
    ): Promise<BrowserOperationResult> {
        try {
            await this.ensureBrowser();
            if (!this.instance.page) {
                throw new Error('Browser page not initialized');
            }

            if (coordinateX !== undefined && coordinateY !== undefined) {
                await this.instance.page.mouse.click(coordinateX, coordinateY);
                await this.instance.page.keyboard.press('Control+a');
                await this.instance.page.keyboard.press('Backspace');
                await this.instance.page.keyboard.type(text);

                if (pressEnter) {
                    await this.instance.page.keyboard.press('Enter');
                    await this.instance.page.waitForLoadState('networkidle');
                }

                return {
                    success: true,
                    inputBy: 'coordinates',
                    coordinates: { x: coordinateX, y: coordinateY },
                    text,
                    pressedEnter: pressEnter
                };
            }

            if (index !== undefined) {
                const inputElements = await this.instance.page.$$('input:not([type="submit"]):not([type="button"]), textarea, [contenteditable="true"]');

                if (index < 0 || index >= inputElements.length) {
                    return { error: `Index ${index} out of range. Only ${inputElements.length} input elements found.` };
                }

                await inputElements[index].click();
                await this.instance.page.keyboard.press('Control+a');
                await this.instance.page.keyboard.press('Backspace');
                await inputElements[index].type(text);

                if (pressEnter) {
                    await this.instance.page.keyboard.press('Enter');
                    await this.instance.page.waitForLoadState('networkidle');
                }

                return {
                    success: true,
                    inputBy: 'index',
                    index,
                    text,
                    pressedEnter: pressEnter
                };
            }

            return { error: 'Either index or coordinates (x,y) must be provided' };
        } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
        }
    }

    async moveMouse(
        coordinateX: number,
        coordinateY: number
    ): Promise<BrowserOperationResult> {
        try {
            await this.ensureBrowser();
            if (!this.instance.page) {
                throw new Error('Browser page not initialized');
            }

            await this.instance.page.mouse.move(coordinateX, coordinateY);

            return {
                success: true,
                coordinates: { x: coordinateX, y: coordinateY }
            };
        } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
        }
    }

    async pressKey(key: string): Promise<BrowserOperationResult> {
        try {
            await this.ensureBrowser();
            if (!this.instance.page) {
                throw new Error('Browser page not initialized');
            }

            await this.instance.page.keyboard.press(key);
            await this.instance.page.waitForLoadState('networkidle');

            return {
                success: true,
                key
            };
        } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
        }
    }

    async selectOption(
        index: number,
        option: number
    ): Promise<BrowserOperationResult> {
        try {
            await this.ensureBrowser();
            if (!this.instance.page) {
                throw new Error('Browser page not initialized');
            }

            const selectElements = await this.instance.page.$$('select');

            if (index < 0 || index >= selectElements.length) {
                return { error: `Index ${index} out of range. Only ${selectElements.length} select elements found.` };
            }

            const selectElement = selectElements[index];
            const options = await selectElement.$$('option');

            if (option < 0 || option >= options.length) {
                return { error: `Option ${option} out of range. Only ${options.length} options found.` };
            }

            const optionValue = await options[option].getAttribute('value');
            if (optionValue === null) {
                return { error: 'Selected option has no value attribute' };
            }

            await selectElement.selectOption({ value: optionValue });
            await this.instance.page.waitForLoadState('networkidle');

            const optionText = await options[option].innerText();

            return {
                success: true,
                selectIndex: index,
                optionIndex: option,
                optionText,
                optionValue
            };
        } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
        }
    }

    async scroll(direction: 'up' | 'down', toEdge: boolean): Promise<BrowserOperationResult> {
        try {
            await this.ensureBrowser();
            if (!this.instance.page) {
                throw new Error('Browser page not initialized');
            }

            if (direction === 'up') {
                if (toEdge) {
                    await this.instance.page.evaluate('window.scrollTo(0, 0)');
                } else {
                    const viewportHeight = (await this.instance.page.viewportSize())?.height ?? 0;
                    await this.instance.page.evaluate(`window.scrollBy(0, -${viewportHeight})`);
                }

                return {
                    success: true,
                    scrolledToTop: toEdge
                };
            } else {
                if (toEdge) {
                    await this.instance.page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
                } else {
                    const viewportHeight = (await this.instance.page.viewportSize())?.height ?? 0;
                    await this.instance.page.evaluate(`window.scrollBy(0, ${viewportHeight})`);
                }

                return {
                    success: true,
                    scrolledToBottom: toEdge
                };
            }
        } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
        }
    }

    async executeJavaScript(javascript: string): Promise<BrowserOperationResult> {
        try {
            await this.ensureBrowser();
            if (!this.instance.page) {
                throw new Error('Browser page not initialized');
            }

            const result = await this.instance.page.evaluate(javascript);

            return {
                success: true,
                result: result !== null ? String(result) : undefined
            };
        } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
        }
    }

    viewConsoleLogs(maxLines?: number): BrowserOperationResult {
        const logs = maxLines && maxLines > 0
            ? this.instance.consoleLogs.slice(-maxLines)
            : this.instance.consoleLogs;

        return {
            logs,
            count: logs.length
        };
    }

    async view(): Promise<BrowserOperationResult> {
        try {
            await this.ensureBrowser();
            if (!this.instance.page) {
                throw new Error('Browser page not initialized');
            }

            // Take screenshot
            const screenshotBuffer = await this.instance.page.screenshot();
            
            // Create a temporary file to store the screenshot
            const tempDir = os.tmpdir();
            const tempFilePath = path.join(tempDir, `screenshot-${Date.now()}.png`);
            await fs.writeFile(tempFilePath, screenshotBuffer);
            
            try {
                // Use OmniParser to extract text from the screenshot
                const client = await this.client;
                
                // Call predict with the correct format
                const result = await client.predict(
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
                } else {
                    throw new Error('Invalid result format');
                }
                
                // Clean up the temporary file
                await fs.unlink(tempFilePath);
                
                return {
                    screenshot: screenshotBuffer,
                    parsedScreenshot: parsedScreenshotBuffer,
                    parsedText: parsedText
                };
            } catch (parseError) {
                // Clean up the temporary file even if parsing fails
                await fs.unlink(tempFilePath).catch(() => {});
                throw parseError;
            }
        } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
        }
    }
} 