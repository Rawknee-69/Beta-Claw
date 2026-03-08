import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { PATHS } from '../core/paths.js';

export interface BrowserSessionConfig {
  sessionId:     string;
  headless:      boolean;
  userAgent?:    string;
  viewport?:     { width: number; height: number };
  storageState?: string;
}

interface BrowserSession {
  cfg:     BrowserSessionConfig;
  browser: Browser;
  ctx:     BrowserContext;
  pages:   Map<string, Page>;
}

class BrowserManager {
  private sessions = new Map<string, BrowserSession>();
  private stateDir = path.join(PATHS.micro, 'browser-state');

  async getOrCreate(cfg: BrowserSessionConfig): Promise<BrowserSession> {
    const existing = this.sessions.get(cfg.sessionId);
    if (existing) return existing;
    return this.create(cfg);
  }

  private async create(cfg: BrowserSessionConfig): Promise<BrowserSession> {
    fs.mkdirSync(this.stateDir, { recursive: true });

    const browser = await chromium.launch({
      headless: cfg.headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const statePath = cfg.storageState ?? path.join(this.stateDir, `${cfg.sessionId}.json`);
    const storageState = fs.existsSync(statePath) ? statePath : undefined;

    const ctx = await browser.newContext({
      userAgent: cfg.userAgent,
      viewport:  cfg.viewport ?? { width: 1280, height: 800 },
      storageState,
    });

    const session: BrowserSession = { cfg, browser, ctx, pages: new Map() };
    this.sessions.set(cfg.sessionId, session);
    console.log(`[browser] Session created: ${cfg.sessionId} (headless=${cfg.headless})`);
    return session;
  }

  async getPage(sessionId: string, tabId = 'default'): Promise<Page> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`No browser session: ${sessionId}. Call open first.`);
    const existing = session.pages.get(tabId);
    if (existing) return existing;
    const page = await session.ctx.newPage();
    session.pages.set(tabId, page);
    return page;
  }

  async saveState(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const statePath = path.join(this.stateDir, `${sessionId}.json`);
    await session.ctx.storageState({ path: statePath });
    console.log(`[browser] State saved: ${statePath}`);
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    await this.saveState(sessionId);
    await session.browser.close();
    this.sessions.delete(sessionId);
    console.log(`[browser] Session closed: ${sessionId}`);
  }

  async closeAll(): Promise<void> {
    for (const id of this.sessions.keys()) {
      await this.closeSession(id);
    }
  }

  listSessions(): string[] {
    return [...this.sessions.keys()];
  }
}

export const browserManager = new BrowserManager();
