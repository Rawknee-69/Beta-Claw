import { browserManager } from './browser-manager.js';
import type { ToolDefinition } from '../core/tools.js';

export const BROWSER_TOOL_DEFINITION: ToolDefinition = {
  name: 'browser',
  description: [
    'Control a browser session. Actions: open, navigate, click, type, screenshot,',
    'get_text, fill, select, wait, close, save_state, evaluate.',
    'sessionId defaults to "default". headless defaults to true.',
  ].join(' '),
  input_schema: {
    type: 'object',
    properties: {
      action:    { type: 'string', description: 'open|navigate|click|type|screenshot|get_text|fill|select|wait|close|save_state|evaluate' },
      sessionId: { type: 'string', description: 'Browser session name (default: "default")' },
      headless:  { type: 'string', description: 'Headless mode (default: true)' },
      tabId:     { type: 'string', description: 'Tab identifier (default: "default")' },
      url:       { type: 'string', description: 'URL to navigate to' },
      selector:  { type: 'string', description: 'CSS selector or text for click/type/fill' },
      text:      { type: 'string', description: 'Text to type or fill' },
      value:     { type: 'string', description: 'Value for select' },
      script:    { type: 'string', description: 'JavaScript to evaluate in page context' },
      waitMs:    { type: 'string', description: 'Milliseconds to wait' },
      savePath:  { type: 'string', description: 'Path to save screenshot' },
    },
    required: ['action'],
  },
};

export async function runBrowserAction(args: Record<string, unknown>): Promise<string> {
  const action    = args['action']    as string;
  const sessionId = (args['sessionId'] as string | undefined) ?? 'default';
  const headless  = args['headless'] !== 'false' && args['headless'] !== false;
  const tabId     = (args['tabId'] as string | undefined) ?? 'default';

  try {
    switch (action) {
      case 'open': {
        await browserManager.getOrCreate({ sessionId, headless });
        return `Browser session "${sessionId}" opened (headless=${headless})`;
      }

      case 'navigate': {
        const page = await getPage(sessionId, tabId, headless);
        await page.goto(args['url'] as string, { waitUntil: 'domcontentloaded', timeout: 30_000 });

        // Give JS-rendered content a moment to appear (best-effort, don't fail if timeout)
        try {
          await page.waitForLoadState('networkidle', { timeout: 5_000 });
        } catch { /* ignore timeout — proceed with whatever is loaded */ }

        // Extract visible text
        let pageText = '';
        try {
          pageText = await page.innerText('body');
        } catch { /* ignore if body unavailable */ }
        const preview = pageText.trim().slice(0, 3000);

        // Extract links: [link text → url] for first 40 anchors with non-empty href
        type LinkEntry = { text: string; href: string };
        let links: LinkEntry[] = [];
        try {
          // Passed as a string so tsc doesn't try to type-check browser globals
          const extractScript = `
            Array.from(document.querySelectorAll('a[href]'))
              .map(a => ({ text: a.innerText.trim().replace(/\\s+/g, ' ').slice(0, 80), href: a.href }))
              .filter(l => l.href && !l.href.startsWith('javascript:') && l.text)
              .slice(0, 40)
          `;
          links = await page.evaluate(extractScript) as LinkEntry[];
        } catch { /* ignore */ }

        const linkBlock = links.length
          ? '\n\nLinks found:\n' + links.map(l => `${l.text} → ${l.href}`).join('\n')
          : '';

        return [
          `Navigated to: ${page.url()}`,
          preview ? `\nPage content:\n${preview}${pageText.trim().length > 3000 ? '\n[truncated]' : ''}` : '',
          linkBlock,
        ].join('');
      }

      case 'click': {
        const page = await getPage(sessionId, tabId, headless);
        await page.click(args['selector'] as string, { timeout: 10_000 });
        return `Clicked: ${args['selector'] as string}`;
      }

      case 'type': {
        const page = await getPage(sessionId, tabId, headless);
        await page.type(args['selector'] as string, args['text'] as string, { delay: 30 });
        return `Typed into: ${args['selector'] as string}`;
      }

      case 'fill': {
        const page = await getPage(sessionId, tabId, headless);
        await page.fill(args['selector'] as string, args['text'] as string);
        return `Filled: ${args['selector'] as string}`;
      }

      case 'select': {
        const page = await getPage(sessionId, tabId, headless);
        await page.selectOption(args['selector'] as string, args['value'] as string);
        return `Selected: ${args['value'] as string} in ${args['selector'] as string}`;
      }

      case 'screenshot': {
        const page     = await getPage(sessionId, tabId, headless);
        const savePath = (args['savePath'] as string | undefined) ?? `/tmp/mc-screenshot-${Date.now()}.png`;
        await page.screenshot({ path: savePath, fullPage: true });
        return `Screenshot saved: ${savePath}`;
      }

      case 'get_text': {
        const page = await getPage(sessionId, tabId, headless);
        const sel  = args['selector'] as string | undefined;
        const text = sel
          ? await page.locator(sel).innerText({ timeout: 5000 })
          : await page.innerText('body');
        return text.slice(0, 8000);
      }

      case 'wait': {
        const page = await getPage(sessionId, tabId, headless);
        const ms   = Number(args['waitMs'] ?? 1000);
        await page.waitForTimeout(ms);
        return `Waited ${ms}ms`;
      }

      case 'evaluate': {
        const page   = await getPage(sessionId, tabId, headless);
        const result = await page.evaluate(args['script'] as string);
        return JSON.stringify(result, null, 2).slice(0, 4000);
      }

      case 'save_state': {
        await browserManager.saveState(sessionId);
        return `Session state saved: ${sessionId}`;
      }

      case 'close': {
        await browserManager.closeSession(sessionId);
        return `Browser session closed: ${sessionId}`;
      }

      default:
        return `Unknown browser action: ${action}`;
    }
  } catch (e) {
    return `Browser error [${action}]: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function getPage(sessionId: string, tabId: string, headless: boolean) {
  await browserManager.getOrCreate({ sessionId, headless });
  return browserManager.getPage(sessionId, tabId);
}
