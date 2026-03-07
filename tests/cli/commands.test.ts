import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { skillsCommand } from '../../src/cli/commands/skills.js';
import { providerCommand } from '../../src/cli/commands/provider.js';
import { memoryCommand } from '../../src/cli/commands/memory.js';
import { vaultCommand } from '../../src/cli/commands/vault.js';
import { rollbackCommand } from '../../src/cli/commands/rollback.js';
import { logsCommand } from '../../src/cli/commands/logs.js';
import { setupCommand } from '../../src/cli/commands/setup.js';
import { doctorCommand } from '../../src/cli/commands/doctor.js';
import { benchmarkCommand } from '../../src/cli/commands/benchmark.js';
import { chatCommand } from '../../src/cli/commands/chat.js';
import { daemonCommand } from '../../src/cli/commands/daemon.js';
import { exportCommand } from '../../src/cli/commands/export.js';

function buildProgram(): Command {
  const program = new Command();
  program.name('microclaw').exitOverride();
  program.addCommand(chatCommand);
  program.addCommand(daemonCommand);
  program.addCommand(skillsCommand);
  program.addCommand(providerCommand);
  program.addCommand(memoryCommand);
  program.addCommand(vaultCommand);
  program.addCommand(rollbackCommand);
  program.addCommand(logsCommand);
  program.addCommand(setupCommand);
  program.addCommand(doctorCommand);
  program.addCommand(benchmarkCommand);
  program.addCommand(exportCommand);
  return program;
}

describe('CLI command registration', () => {
  it('registers all 12 top-level commands', () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain('chat');
    expect(names).toContain('start');
    expect(names).toContain('skills');
    expect(names).toContain('provider');
    expect(names).toContain('memory');
    expect(names).toContain('vault');
    expect(names).toContain('rollback');
    expect(names).toContain('logs');
    expect(names).toContain('setup');
    expect(names).toContain('doctor');
    expect(names).toContain('benchmark');
    expect(names).toContain('export');
    expect(names.length).toBe(12);
  });

  it('each command is a Commander instance', () => {
    const commands = [
      skillsCommand, providerCommand, memoryCommand,
      vaultCommand, rollbackCommand, logsCommand,
      setupCommand, doctorCommand, benchmarkCommand,
      chatCommand, daemonCommand, exportCommand,
    ];
    for (const cmd of commands) {
      expect(cmd).toBeInstanceOf(Command);
    }
  });
});

describe('skills command', () => {
  it('has correct name and description', () => {
    expect(skillsCommand.name()).toBe('skills');
    expect(skillsCommand.description()).toMatch(/skill/i);
  });

  it('has list, reload, info, install subcommands', () => {
    const subs = skillsCommand.commands.map((c) => c.name());
    expect(subs).toContain('list');
    expect(subs).toContain('reload');
    expect(subs).toContain('info');
    expect(subs).toContain('install');
  });

  it('info subcommand requires an argument', () => {
    const info = skillsCommand.commands.find((c) => c.name() === 'info');
    expect(info).toBeDefined();
    const args = info!.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]!.required).toBe(true);
  });
});

describe('provider command', () => {
  it('has correct name and description', () => {
    expect(providerCommand.name()).toBe('provider');
    expect(providerCommand.description()).toMatch(/provider/i);
  });

  it('has list, add, remove, models, refresh subcommands', () => {
    const subs = providerCommand.commands.map((c) => c.name());
    expect(subs).toContain('list');
    expect(subs).toContain('add');
    expect(subs).toContain('remove');
    expect(subs).toContain('models');
    expect(subs).toContain('refresh');
  });

  it('remove subcommand requires an id argument', () => {
    const remove = providerCommand.commands.find((c) => c.name() === 'remove');
    expect(remove).toBeDefined();
    expect(remove!.registeredArguments.length).toBeGreaterThanOrEqual(1);
    expect(remove!.registeredArguments[0]!.required).toBe(true);
  });
});

describe('memory command', () => {
  it('has correct name', () => {
    expect(memoryCommand.name()).toBe('memory');
  });

  it('has show, search, clear, export subcommands', () => {
    const subs = memoryCommand.commands.map((c) => c.name());
    expect(subs).toContain('show');
    expect(subs).toContain('search');
    expect(subs).toContain('clear');
    expect(subs).toContain('export');
  });

  it('search subcommand requires a query argument', () => {
    const search = memoryCommand.commands.find((c) => c.name() === 'search');
    expect(search).toBeDefined();
    expect(search!.registeredArguments[0]!.required).toBe(true);
  });

  it('show subcommand has optional groupId argument', () => {
    const show = memoryCommand.commands.find((c) => c.name() === 'show');
    expect(show).toBeDefined();
    expect(show!.registeredArguments[0]!.required).toBe(false);
  });
});

describe('vault command', () => {
  it('has correct name', () => {
    expect(vaultCommand.name()).toBe('vault');
  });

  it('has show, add, remove, rotate subcommands', () => {
    const subs = vaultCommand.commands.map((c) => c.name());
    expect(subs).toContain('show');
    expect(subs).toContain('add');
    expect(subs).toContain('remove');
    expect(subs).toContain('rotate');
  });

  it('add subcommand requires a name argument', () => {
    const add = vaultCommand.commands.find((c) => c.name() === 'add');
    expect(add).toBeDefined();
    expect(add!.registeredArguments[0]!.required).toBe(true);
  });
});

describe('rollback command', () => {
  it('has correct name', () => {
    expect(rollbackCommand.name()).toBe('rollback');
  });

  it('has list and to subcommands', () => {
    const subs = rollbackCommand.commands.map((c) => c.name());
    expect(subs).toContain('list');
    expect(subs).toContain('to');
  });

  it('to subcommand requires a snapshot argument', () => {
    const to = rollbackCommand.commands.find((c) => c.name() === 'to');
    expect(to).toBeDefined();
    expect(to!.registeredArguments[0]!.required).toBe(true);
  });
});

describe('logs command', () => {
  it('has correct name', () => {
    expect(logsCommand.name()).toBe('logs');
  });

  it('has --follow option', () => {
    const opts = logsCommand.options.map((o) => o.long);
    expect(opts).toContain('--follow');
  });

  it('has --level option', () => {
    const opts = logsCommand.options.map((o) => o.long);
    expect(opts).toContain('--level');
  });

  it('has --group option', () => {
    const opts = logsCommand.options.map((o) => o.long);
    expect(opts).toContain('--group');
  });
});

describe('setup command', () => {
  it('has correct name', () => {
    expect(setupCommand.name()).toBe('setup');
  });

  it('has --reset option', () => {
    const opts = setupCommand.options.map((o) => o.long);
    expect(opts).toContain('--reset');
  });

  it('has --mode option', () => {
    const opts = setupCommand.options.map((o) => o.long);
    expect(opts).toContain('--mode');
  });
});

describe('doctor command', () => {
  it('has correct name and description', () => {
    expect(doctorCommand.name()).toBe('doctor');
    expect(doctorCommand.description()).toMatch(/dependencies|health|check/i);
  });

  it('has no subcommands', () => {
    expect(doctorCommand.commands.length).toBe(0);
  });
});

describe('benchmark command', () => {
  it('has correct name and description', () => {
    expect(benchmarkCommand.name()).toBe('benchmark');
    expect(benchmarkCommand.description()).toMatch(/benchmark|token/i);
  });

  it('has no subcommands', () => {
    expect(benchmarkCommand.commands.length).toBe(0);
  });
});

describe('help text generation', () => {
  it('program help includes all command names', () => {
    const program = buildProgram();
    const help = program.helpInformation();
    expect(help).toContain('skills');
    expect(help).toContain('provider');
    expect(help).toContain('memory');
    expect(help).toContain('vault');
    expect(help).toContain('rollback');
    expect(help).toContain('logs');
    expect(help).toContain('setup');
    expect(help).toContain('doctor');
    expect(help).toContain('benchmark');
    expect(help).toContain('export');
  });

  it('skills help mentions subcommands', () => {
    const help = skillsCommand.helpInformation();
    expect(help).toContain('list');
    expect(help).toContain('reload');
    expect(help).toContain('info');
    expect(help).toContain('install');
  });
});
