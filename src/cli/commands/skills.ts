import { Command } from 'commander';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';

const SkillInfoSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  command: z.string().optional(),
});

type SkillInfo = z.infer<typeof SkillInfoSchema>;

function getSkillsDir(): string {
  return path.resolve('skills');
}

function listSkills(): void {
  const dir = getSkillsDir();
  if (!fs.existsSync(dir)) {
    console.log('No skills directory found at', dir);
    return;
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const skillDirs = entries.filter((e) => e.isDirectory());
  if (skillDirs.length === 0) {
    console.log('No skills installed.');
    return;
  }
  console.log(`\nLoaded skills (${skillDirs.length}):\n`);
  for (const entry of skillDirs) {
    const skillPath = path.join(dir, entry.name, 'SKILL.md');
    const exists = fs.existsSync(skillPath);
    const marker = exists ? '✓' : '?';
    console.log(`  ${marker}  ${entry.name}`);
  }
  console.log();
}

function reloadSkills(): void {
  console.log('Force-reloading all skills...');
  const dir = getSkillsDir();
  if (!fs.existsSync(dir)) {
    console.log('No skills directory found.');
    return;
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const count = entries.filter((e) => e.isDirectory()).length;
  console.log(`Reloaded ${count} skill(s).`);
}

function showSkillInfo(command: string): void {
  const parsed = z.string().min(1).safeParse(command);
  if (!parsed.success) {
    console.error('Invalid skill command name.');
    return;
  }
  const dir = getSkillsDir();
  const skillDir = path.join(dir, parsed.data);
  if (!fs.existsSync(skillDir)) {
    console.error(`Skill "${parsed.data}" not found.`);
    return;
  }
  const skillFile = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(skillFile)) {
    console.error(`Skill "${parsed.data}" has no SKILL.md file.`);
    return;
  }
  const content = fs.readFileSync(skillFile, 'utf-8');
  const info: SkillInfo = SkillInfoSchema.parse({
    name: parsed.data,
    description: content.split('\n')[0] ?? '',
    command: parsed.data,
  });
  console.log(`\nSkill: ${info.name}`);
  console.log(`Description: ${info.description ?? 'N/A'}`);
  console.log(`Path: ${skillDir}\n`);
}

function installSkill(sourcePath: string): void {
  const validated = z.string().min(1).safeParse(sourcePath);
  if (!validated.success) {
    console.error('Invalid path provided.');
    return;
  }
  const src = path.resolve(validated.data);
  if (!fs.existsSync(src)) {
    console.error(`Source path "${src}" does not exist.`);
    return;
  }
  const skillName = path.basename(src);
  const dest = path.join(getSkillsDir(), skillName);
  if (fs.existsSync(dest)) {
    console.error(`Skill "${skillName}" already installed.`);
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log(`Installed skill "${skillName}" to ${dest}`);
}

const skillsCommand = new Command('skills')
  .description('Manage agent skills');

skillsCommand
  .command('list')
  .description('List all loaded skills')
  .action(() => {
    listSkills();
  });

skillsCommand
  .command('reload')
  .description('Force hot-reload all skills')
  .action(() => {
    reloadSkills();
  });

skillsCommand
  .command('info')
  .description('Show skill details')
  .argument('<command>', 'Skill command name')
  .action((cmd: string) => {
    showSkillInfo(cmd);
  });

skillsCommand
  .command('install')
  .description('Copy skill folder into skills/')
  .argument('<path>', 'Path to skill folder')
  .action((skillPath: string) => {
    installSkill(skillPath);
  });

export { skillsCommand };
