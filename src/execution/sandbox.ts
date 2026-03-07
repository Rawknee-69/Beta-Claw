import { execFile } from 'node:child_process';
import { z } from 'zod';

const SandboxConfigSchema = z.object({
  preferredRuntime: z.enum(['docker', 'nsjail', 'none']).default('docker'),
  dockerImage: z.string().default('node:20-slim'),
  timeoutMs: z.number().int().min(100).default(30_000),
  memoryLimitMb: z.number().int().min(16).default(256),
  networkEnabled: z.boolean().default(false),
  allowDirectExec: z.boolean().default(false),
});

type SandboxConfig = z.infer<typeof SandboxConfigSchema>;

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

interface ExecOptions {
  timeoutMs?: number;
  env?: Record<string, string>;
  cwd?: string;
}

const DESTRUCTIVE_PATTERNS: ReadonlyArray<RegExp> = [
  /\brm\s+(-[a-zA-Z]*\s+)*\//,
  /\bmkfs\b/,
  /\bdd\s+/,
  />\s*\/dev\//,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bsystemctl\s+(stop|disable|mask)\b/,
];

type SandboxType = 'docker' | 'nsjail' | 'none';

export class Sandbox {
  private readonly config: SandboxConfig;
  private detectedType: SandboxType | null = null;

  constructor(config?: Partial<SandboxConfig>) {
    this.config = SandboxConfigSchema.parse(config ?? {});
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    const CommandSchema = z.string().min(1);
    CommandSchema.parse(command);

    const timeout = options?.timeoutMs ?? this.config.timeoutMs;
    const sandboxType = await this.detectType();

    switch (sandboxType) {
      case 'docker':
        return this.execDocker(command, timeout, options);
      case 'nsjail':
        return this.execNsjail(command, timeout, options);
      case 'none':
        return this.execDirect(command, timeout, options);
    }
  }

  async isAvailable(): Promise<boolean> {
    const type = await this.detectType();
    return type !== 'none';
  }

  getType(): string {
    return this.detectedType ?? 'unknown';
  }

  getConfig(): Readonly<SandboxConfig> {
    return this.config;
  }

  private async detectType(): Promise<SandboxType> {
    if (this.detectedType !== null) return this.detectedType;

    if (this.config.preferredRuntime === 'none') {
      this.detectedType = 'none';
      return 'none';
    }

    if (this.config.preferredRuntime === 'docker') {
      if (await this.checkBinaryExists('docker')) {
        this.detectedType = 'docker';
        return 'docker';
      }
      if (await this.checkBinaryExists('nsjail')) {
        this.detectedType = 'nsjail';
        return 'nsjail';
      }
    }

    if (this.config.preferredRuntime === 'nsjail') {
      if (await this.checkBinaryExists('nsjail')) {
        this.detectedType = 'nsjail';
        return 'nsjail';
      }
      if (await this.checkBinaryExists('docker')) {
        this.detectedType = 'docker';
        return 'docker';
      }
    }

    this.detectedType = 'none';
    return 'none';
  }

  private checkBinaryExists(binary: string): Promise<boolean> {
    return new Promise((resolve) => {
      execFile('which', [binary], (error) => {
        resolve(error === null);
      });
    });
  }

  private execDocker(command: string, timeout: number, options?: ExecOptions): Promise<ExecResult> {
    const args = [
      'run', '--rm',
      '--memory', `${this.config.memoryLimitMb}m`,
      ...(this.config.networkEnabled ? [] : ['--network', 'none']),
    ];

    if (options?.env) {
      for (const [key, value] of Object.entries(options.env)) {
        args.push('-e', `${key}=${value}`);
      }
    }

    if (options?.cwd) {
      args.push('-w', options.cwd);
    }

    args.push(this.config.dockerImage, 'sh', '-c', command);

    return this.runProcess('docker', args, timeout);
  }

  private execNsjail(command: string, timeout: number, _options?: ExecOptions): Promise<ExecResult> {
    const args = [
      '--mode', 'o',
      '--time_limit', String(Math.ceil(timeout / 1000)),
      '--rlimit_as', String(this.config.memoryLimitMb),
      '--', '/bin/sh', '-c', command,
    ];

    return this.runProcess('nsjail', args, timeout);
  }

  private execDirect(command: string, timeout: number, options?: ExecOptions): Promise<ExecResult> {
    if (!this.config.allowDirectExec) {
      throw new Error(
        'No sandbox runtime available and direct execution is disabled. ' +
        'Set allowDirectExec: true to allow unsandboxed execution.',
      );
    }

    if (this.isDestructiveCommand(command)) {
      throw new Error(
        `Refusing to execute potentially destructive command without sandbox: ${command}`,
      );
    }

    const execOptions: ExecOptions = { ...options };
    return this.runProcess('sh', ['-c', command], timeout, execOptions);
  }

  private isDestructiveCommand(command: string): boolean {
    return DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command));
  }

  private runProcess(
    binary: string,
    args: string[],
    timeout: number,
    options?: ExecOptions,
  ): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      const start = performance.now();

      const child = execFile(
        binary,
        args,
        {
          timeout,
          maxBuffer: 10 * 1024 * 1024,
          env: options?.env ? { ...process.env, ...options.env } : undefined,
          cwd: options?.cwd,
        },
        (error, stdout, stderr) => {
          const durationMs = Math.round(performance.now() - start);

          if (error && 'killed' in error && error.killed) {
            resolve({
              stdout: stdout ?? '',
              stderr: `Process killed after ${timeout}ms timeout\n${stderr ?? ''}`,
              exitCode: 137,
              durationMs,
            });
            return;
          }

          const exitCode = error && 'code' in error && typeof error.code === 'number'
            ? error.code
            : error ? 1 : 0;

          resolve({
            stdout: stdout ?? '',
            stderr: stderr ?? '',
            exitCode,
            durationMs,
          });
        },
      );

      child.on('error', (err) => {
        reject(new Error(`Failed to start process "${binary}": ${err.message}`));
      });
    });
  }

  /** Reset cached type detection (useful after environment changes). */
  resetDetection(): void {
    this.detectedType = null;
  }

  /** Directly set sandbox type (primarily for testing). */
  setType(type: SandboxType): void {
    this.detectedType = type;
  }
}

export type { SandboxConfig, ExecResult, ExecOptions, SandboxType };
export { SandboxConfigSchema };
