#!/usr/bin/env node
import dotenv from 'dotenv';
dotenv.config();

import { Command } from 'commander';
import { chatCommand } from './commands/chat.js';
import { startCommand, stopCommand, restartCommand, statusCommand } from './commands/daemon.js';
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
import { heartbeatCommand } from './commands/heartbeat.js';
import { scheduleCommand } from './commands/schedule.js';

const program = new Command();

program
  .name('microclaw')
  .description('Open, provider-agnostic AI agent runtime')
  .version('3.0.0');

program.addCommand(chatCommand);
program.addCommand(startCommand);
program.addCommand(stopCommand);
program.addCommand(restartCommand);
program.addCommand(statusCommand);
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
program.addCommand(heartbeatCommand);
program.addCommand(scheduleCommand);

program.parse();
