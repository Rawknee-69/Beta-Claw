import fs from 'fs';
import path from 'path';
import { PATHS } from './paths.js';

export function ensureWorkspace(groupId: string): string {
  const dir = path.join(PATHS.workspaces, groupId);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'media'), { recursive: true });
  return dir;
}

export function workspacePath(groupId: string): string {
  return path.join(PATHS.workspaces, groupId);
}
