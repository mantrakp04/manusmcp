import FileService from "./fileService";
import ShellService from "./shellService";
import BrowserService from "./browserService";

/**
 * SessionManager provides session-specific instances of services
 */
class SessionManager {
  private static instance: SessionManager;
  private sessions: Map<string, {
    file: FileService;
    shell: ShellService;
    browser: BrowserService;
  }> = new Map();

  private constructor() {}

  public static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }

  /**
   * Get service instances for a specific session
   */
  public getSessionServices(sessionId: string) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        file: new FileService(sessionId),
        shell: new ShellService(sessionId),
        browser: new BrowserService(sessionId)
      });
    }
    
    return this.sessions.get(sessionId)!;
  }
  
  /**
   * Get all tools available for a session
   */
  public getSessionTools(sessionId: string): any[] {
    const services = this.getSessionServices(sessionId);
    return [
      ...services.file.fileTools,
      ...services.shell.shellTools,
      ...services.browser.browserTools
    ];
  }

  /**
   * Clear a session and its resources
   */
  public async clearSession(sessionId: string): Promise<void> {
    if (this.sessions.has(sessionId)) {
      // Cleanup resources for services
      const services = this.sessions.get(sessionId)!;
      
      // Clean up shell sessions
      if (services.shell.cleanup) {
        await services.shell.cleanup();
      }
      
      // Future: Add cleanup for browser resources if needed
      
      this.sessions.delete(sessionId);
    }
  }
  
  /**
   * Clear all sessions and resources
   */
  public async clearAllSessions(): Promise<void> {
    const sessionIds = [...this.sessions.keys()];
    for (const sessionId of sessionIds) {
      await this.clearSession(sessionId);
    }
  }
}

// Export the session manager singleton
export const sessionManager = SessionManager.getInstance();
