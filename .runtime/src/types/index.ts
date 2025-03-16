import type { Browser, BrowserContext, Page } from 'playwright';

export interface ShellSession {
    process: any;  // Node.js child process
    output: string[];
    command: string;
    execDir: string;
    running: boolean;
    returnCode?: number;
}

export interface BrowserInstance {
    browser: Browser | null;
    context: BrowserContext | null;
    page: Page | null;
    consoleLogs: string[];
}

export interface FileOperationResult {
    success?: boolean;
    error?: string;
    content?: string;
    matches?: Array<{
        lineNumber: number;
        line: string;
        match: string;
        start: number;
        end: number;
    }>;
    files?: string[];
}

export interface ShellOperationResult {
    success?: boolean;
    error?: string;
    sessionId?: string;
    pid?: number;
    output?: string;
    command?: string;
    execDir?: string;
    running?: boolean;
    returnCode?: number;
    alreadyCompleted?: boolean;
    timeout?: boolean;
    partialOutput?: string;
    completed?: boolean;
    message?: string;
}

export interface BrowserOperationResult {
    success?: boolean;
    error?: string;
    title?: string;
    url?: string;
    status?: number;
    clickedBy?: string;
    coordinates?: { x: number; y: number };
    index?: number;
    inputBy?: string;
    text?: string;
    pressedEnter?: boolean;
    key?: string;
    selectIndex?: number;
    optionIndex?: number;
    optionText?: string;
    optionValue?: string;
    scrolledToTop?: boolean;
    scrolledToBottom?: boolean;
    result?: string;
    logs?: string[];
    count?: number;
    parsedText?: string;
    screenshot?: Buffer;
    parsedScreenshot?: Buffer;
} 