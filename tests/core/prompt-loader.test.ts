import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PromptLoader } from '../../src/core/prompt-loader.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function tmpPromptDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-loader-test-'));
}

function writePrompt(dir: string, name: string, content: string): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

describe('PromptLoader', () => {
  let tmpDir: string;
  let loader: PromptLoader;

  beforeEach(() => {
    tmpDir = tmpPromptDir();
    loader = new PromptLoader(tmpDir);
  });

  afterEach(() => {
    loader.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads a prompt file and returns its content', async () => {
    writePrompt(tmpDir, 'simple.txt', 'Hello world');
    const content = await loader.load('simple.txt');
    expect(content).toBe('Hello world');
  });

  it('caches loaded prompts (second load uses cache)', async () => {
    const filePath = writePrompt(tmpDir, 'cached.txt', 'original content');

    const first = await loader.load('cached.txt');
    fs.writeFileSync(filePath, 'modified on disk', 'utf-8');
    const second = await loader.load('cached.txt');

    expect(first).toBe('original content');
    expect(second).toBe('original content');
  });

  it('interpolates {{VARIABLE}} syntax', async () => {
    writePrompt(
      tmpDir,
      'greet.txt',
      'Hello {{NAME}}, welcome to {{PLACE}}!',
    );
    const result = await loader.render('greet.txt', {
      NAME: 'Alice',
      PLACE: 'Wonderland',
    });
    expect(result).toBe('Hello Alice, welcome to Wonderland!');
  });

  it('leaves unmatched variables as-is', async () => {
    writePrompt(
      tmpDir,
      'partial.txt',
      'Hello {{NAME}}, you have {{COUNT}} items',
    );
    const result = await loader.render('partial.txt', { NAME: 'Bob' });
    expect(result).toBe('Hello Bob, you have {{COUNT}} items');
  });

  it('handles template with no variables', async () => {
    writePrompt(tmpDir, 'plain.txt', 'No variables here');
    const result = await loader.render('plain.txt', {});
    expect(result).toBe('No variables here');
  });

  it('invalidates cache on file change when watching', async () => {
    const filePath = writePrompt(tmpDir, 'watched.txt', 'version1');

    loader.watch();
    const first = await loader.load('watched.txt');
    expect(first).toBe('version1');

    await new Promise((r) => setTimeout(r, 300));

    fs.writeFileSync(filePath, 'version2', 'utf-8');
    await new Promise((r) => setTimeout(r, 300));

    const second = await loader.load('watched.txt');
    expect(second).toBe('version2');
  });

  it('throws when loading a nonexistent file', async () => {
    await expect(loader.load('does-not-exist.txt')).rejects.toThrow();
  });

  it('throws on empty path', async () => {
    await expect(loader.load('')).rejects.toThrow();
  });

  it('strips version comment from first line', async () => {
    writePrompt(
      tmpDir,
      'versioned.txt',
      '# version:1.0 | updated:2025-01-15 | author:microclaw\nActual prompt content',
    );
    const content = await loader.load('versioned.txt');
    expect(content).toBe('Actual prompt content');
    expect(content).not.toContain('version:');
    expect(content).not.toContain('#');
  });

  it('strips version comment but preserves remaining lines', async () => {
    writePrompt(
      tmpDir,
      'multi.txt',
      '# version:2.0 | updated:2025-06-01 | author:microclaw\nLine one\nLine two\nLine three',
    );
    const content = await loader.load('multi.txt');
    expect(content).toBe('Line one\nLine two\nLine three');
  });

  it('does not strip non-version first lines', async () => {
    writePrompt(tmpDir, 'noversion.txt', 'Regular first line\nSecond line');
    const content = await loader.load('noversion.txt');
    expect(content).toBe('Regular first line\nSecond line');
  });

  it('renders a prompt with version comment and variables', async () => {
    writePrompt(
      tmpDir,
      'full.txt',
      '# version:1.0 | updated:2025-01-15 | author:microclaw\nHello {{USER}}, your role is {{ROLE}}.',
    );
    const result = await loader.render('full.txt', {
      USER: 'Charlie',
      ROLE: 'admin',
    });
    expect(result).toBe('Hello Charlie, your role is admin.');
    expect(result).not.toContain('version:');
  });

  it('close is safe to call multiple times', () => {
    loader.watch();
    loader.close();
    loader.close();
  });

  it('watch is idempotent', () => {
    loader.watch();
    loader.watch();
    loader.close();
  });
});
