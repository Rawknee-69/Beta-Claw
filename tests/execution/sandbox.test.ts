import { describe, it, expect, beforeEach } from 'vitest';
import { Sandbox } from '../../src/execution/sandbox.js';
import type { ExecResult } from '../../src/execution/sandbox.js';

describe('Sandbox', () => {
  let sandbox: Sandbox;

  beforeEach(() => {
    sandbox = new Sandbox({
      preferredRuntime: 'none',
      allowDirectExec: true,
    });
  });

  it('exec returns ExecResult with stdout, stderr, exitCode, durationMs', async () => {
    sandbox.setType('none');
    const result = await sandbox.exec('echo hello');
    expect(result.stdout.trim()).toBe('hello');
    expect(result.stderr).toBeDefined();
    expect(result.exitCode).toBe(0);
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('exec captures stderr', async () => {
    sandbox.setType('none');
    const result = await sandbox.exec('echo err >&2');
    expect(result.stderr.trim()).toBe('err');
  });

  it('exec returns non-zero exit code on failure', async () => {
    sandbox.setType('none');
    const result = await sandbox.exec('exit 42');
    expect(result.exitCode).toBe(42);
  });

  it('isAvailable returns false when no sandbox runtime is found', async () => {
    sandbox.setType('none');
    const available = await sandbox.isAvailable();
    expect(available).toBe(false);
  });

  it('isAvailable returns true when docker is detected', async () => {
    sandbox.setType('docker');
    const available = await sandbox.isAvailable();
    expect(available).toBe(true);
  });

  it('getType returns the detected sandbox type', () => {
    sandbox.setType('docker');
    expect(sandbox.getType()).toBe('docker');

    sandbox.setType('nsjail');
    expect(sandbox.getType()).toBe('nsjail');

    sandbox.setType('none');
    expect(sandbox.getType()).toBe('none');
  });

  it('getType returns unknown before detection', () => {
    const fresh = new Sandbox({ preferredRuntime: 'docker' });
    expect(fresh.getType()).toBe('unknown');
  });

  it('throws on direct exec of destructive command', async () => {
    sandbox.setType('none');
    await expect(sandbox.exec('rm -rf /')).rejects.toThrow('destructive');
  });

  it('allows non-destructive direct exec', async () => {
    sandbox.setType('none');
    const result = await sandbox.exec('echo safe');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('safe');
  });

  it('throws when direct exec is disabled and no sandbox available', async () => {
    const restricted = new Sandbox({
      preferredRuntime: 'none',
      allowDirectExec: false,
    });
    restricted.setType('none');
    await expect(restricted.exec('echo test')).rejects.toThrow('direct execution is disabled');
  });

  it('uses default config values', () => {
    const defaultSandbox = new Sandbox();
    const config = defaultSandbox.getConfig();
    expect(config.preferredRuntime).toBe('docker');
    expect(config.dockerImage).toBe('node:20-slim');
    expect(config.timeoutMs).toBe(30_000);
    expect(config.memoryLimitMb).toBe(256);
    expect(config.networkEnabled).toBe(false);
    expect(config.allowDirectExec).toBe(false);
  });

  it('accepts custom config', () => {
    const custom = new Sandbox({
      dockerImage: 'python:3.12',
      timeoutMs: 5000,
      memoryLimitMb: 512,
      networkEnabled: true,
    });
    const config = custom.getConfig();
    expect(config.dockerImage).toBe('python:3.12');
    expect(config.timeoutMs).toBe(5000);
    expect(config.memoryLimitMb).toBe(512);
    expect(config.networkEnabled).toBe(true);
  });

  it('resetDetection clears cached type', () => {
    sandbox.setType('docker');
    expect(sandbox.getType()).toBe('docker');
    sandbox.resetDetection();
    expect(sandbox.getType()).toBe('unknown');
  });

  it('validates command is non-empty string', async () => {
    sandbox.setType('none');
    await expect(sandbox.exec('')).rejects.toThrow();
  });

  it('detects multiple destructive patterns', async () => {
    sandbox.setType('none');
    await expect(sandbox.exec('mkfs.ext4 /dev/sda1')).rejects.toThrow('destructive');
    await expect(sandbox.exec('shutdown -h now')).rejects.toThrow('destructive');
    await expect(sandbox.exec('reboot')).rejects.toThrow('destructive');
  });
});
