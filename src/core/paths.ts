import path from 'node:path';

export const WORKSPACE       = path.resolve('.workspace');
export const DB_PATH         = path.join(WORKSPACE, 'db', 'microclaw.db');
export const GROUPS_DIR      = path.join(WORKSPACE, 'groups');
export const IMAGES_DIR      = path.join(WORKSPACE, 'images');
export const DOWNLOADS_DIR   = path.join(WORKSPACE, 'downloads');
export const WORK_DIR        = path.join(WORKSPACE, 'work');
export const EXPORTS_DIR     = path.join(WORKSPACE, 'exports');
export const MICRO_DIR       = path.resolve('.micro');
export const CONFIG_PATH     = path.join(MICRO_DIR, 'config.toon');
export const LOGS_DIR        = path.join(MICRO_DIR, 'logs');
export const VAULT_PATH      = path.join(MICRO_DIR, 'vault.enc');
export const SNAPSHOTS_DIR   = path.join(MICRO_DIR, 'snapshots');
export const PROMPTS_DIR     = path.resolve('prompts');
export const HEARTBEAT_PROMPT_PATH = path.join(PROMPTS_DIR, 'heartbeat', 'heartbeat-prompt.toon');
export const GLOBAL_MEMORY_PATH = path.resolve('microclaw.md');

// Per-file filenames (relative to groups/{groupId}/)
export const MEMORY_FILENAME            = 'memory.md';
export const SOUL_FILENAME              = 'soul.md';
export const CLAUDE_FILENAME            = 'CLAUDE.md';
export const HEARTBEAT_FILENAME         = 'HEARTBEAT.md';
export const PERSONA_SUPPLEMENT_FILENAME = 'persona-supplement.md';
export const BEHAVIOR_FILENAME          = 'behavior.md';
