import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from '../core/paths.js';
import { browserManager } from '../browser/browser-manager.js';

export interface GmailAccountConfig {
  account:          string;
  label:            string;
  gcpProject:       string;
  topicName:        string;
  port:             number;
  deliverTo?:       string;
  model?:           string;
  browserSession?:  string;
}

const STATE_FILE = path.join(PATHS.micro, 'gmail-accounts.json');

class GmailManager {
  private accounts = new Map<string, GmailAccountConfig>();

  constructor() {
    this.load();
  }

  private load(): void {
    if (!fs.existsSync(STATE_FILE)) return;
    try {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as GmailAccountConfig[];
      for (const cfg of data) this.accounts.set(cfg.account, cfg);
    } catch { /* fresh start */ }
  }

  private save(): void {
    fs.mkdirSync(PATHS.micro, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify([...this.accounts.values()], null, 2));
  }

  addAccount(cfg: GmailAccountConfig): void {
    if (!cfg.port) cfg.port = 8788 + this.accounts.size;
    this.accounts.set(cfg.account, cfg);
    this.save();
  }

  getAccount(email: string): GmailAccountConfig | undefined {
    return this.accounts.get(email);
  }

  listAccounts(): GmailAccountConfig[] {
    return [...this.accounts.values()];
  }

  async startWatch(email: string): Promise<string> {
    const cfg = this.accounts.get(email);
    if (!cfg) return `Unknown account: ${email}. Add it first with: microclaw gmail add ${email}`;

    if (!this.gogAvailable()) {
      return 'gog (gogcli) not installed. Install: bash <(curl -sSf https://gogcli.sh/)';
    }

    const watch = spawnSync('gog', [
      'gmail', 'watch', 'start',
      '--account', cfg.account,
      '--label', cfg.label,
      '--topic', `projects/${cfg.gcpProject}/topics/${cfg.topicName}`,
    ], { encoding: 'utf-8', timeout: 30_000 });

    if (watch.status !== 0) return `Watch start failed: ${watch.stderr}`;

    spawnSync('bash', ['-c', [
      'gog gmail watch serve',
      `--account ${cfg.account}`,
      '--bind 127.0.0.1',
      `--port ${cfg.port}`,
      '--path /gmail-pubsub',
      '--include-body',
      '--max-bytes 20000',
      `--hook-url http://127.0.0.1:18789/hooks/gmail`,
      '&',
    ].join(' ')], { encoding: 'utf-8', timeout: 5_000 });

    return `Watching ${cfg.account} on port ${cfg.port}. Emails will be delivered to group: ${cfg.deliverTo ?? 'none'}`;
  }

  async stopWatch(email: string): Promise<string> {
    const cfg = this.accounts.get(email);
    if (!cfg) return `Unknown account: ${email}`;
    const r = spawnSync('gog', ['gmail', 'watch', 'stop', '--account', email], { encoding: 'utf-8', timeout: 10_000 });
    return r.status === 0 ? `Stopped watching ${email}` : `Stop failed: ${r.stderr}`;
  }

  async linkBrowserSession(email: string, sessionId: string, headless = true): Promise<string> {
    const cfg = this.accounts.get(email);
    if (!cfg) return `Unknown account: ${email}`;

    const statePath = path.join(PATHS.micro, 'browser-state', `${sessionId}.json`);
    const hasState  = fs.existsSync(statePath);

    if (!hasState) {
      await browserManager.getOrCreate({ sessionId, headless: false });
      const page = await browserManager.getPage(sessionId);
      await page.goto('https://accounts.google.com');
      return [
        `Opened browser for ${email} (headed mode — you need to log in manually).`,
        'Navigate to Gmail, complete Google sign-in, then run:',
        `  microclaw gmail save-session ${email}`,
        'This will save the auth state so future sessions are headless.',
      ].join('\n');
    }

    cfg.browserSession = sessionId;
    this.save();
    await browserManager.getOrCreate({ sessionId, headless, storageState: statePath });
    return `Browser session "${sessionId}" linked to Gmail account ${email} using saved auth state.`;
  }

  private gogAvailable(): boolean {
    return spawnSync('gog', ['--version'], { encoding: 'utf-8', timeout: 3_000 }).status === 0;
  }
}

export let gmailManager: GmailManager;

export function initGmailManager(): void {
  gmailManager = new GmailManager();
}
