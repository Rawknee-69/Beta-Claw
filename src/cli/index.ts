import { Command } from 'commander';
import { chatCommand } from './commands/chat.js';
import { daemonCommand } from './commands/daemon.js';
import { skillsCommand } from './commands/skills.js';
import { providerCommand } from './commands/provider.js';
import { memoryCommand } from './commands/memory.js';
import { vaultCommand } from './commands/vault.js';
import { rollbackCommand } from './commands/rollback.js';
import { logsCommand } from './commands/logs.js';
import { setupCommand } from './commands/setup.js';
import { doctorCommand } from './commands/doctor.js';
import { benchmarkCommand } from './commands/benchmark.js';
import { exportCommand } from './commands/export.js';

const program = new Command();

program
  .name('microclaw')
  .description('Open, provider-agnostic AI agent runtime')
  .version('2.0.0');

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

program.parse();
