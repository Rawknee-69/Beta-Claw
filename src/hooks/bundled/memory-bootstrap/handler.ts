import type { HookHandler } from '../../types.js';
import fs from 'fs';
import path from 'path';

const handler: HookHandler = async (event) => {
  if (event.type === 'gateway' && event.action === 'startup') {
    const groupsDir = path.join(process.cwd(), 'groups');
    if (!fs.existsSync(groupsDir)) return;
    for (const entry of fs.readdirSync(groupsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const memPath = path.join(groupsDir, entry.name, 'MEMORY.md');
      if (fs.existsSync(memPath)) {
        const size = fs.statSync(memPath).size;
        console.log(`[memory-bootstrap] Group ${entry.name}: MEMORY.md (${size} bytes)`);
      }
    }
    return;
  }

  if (event.type === 'command' && (event.action === 'new' || event.action === 'reset')) {
    const groupId = event.context.groupId;
    if (!groupId) return;
    const memPath = path.join(process.cwd(), 'groups', groupId, 'MEMORY.md');
    if (!fs.existsSync(memPath)) return;
    const content = fs.readFileSync(memPath, 'utf-8').trim();
    if (!content) return;
    event.context.memoryPreloaded = true;
    event.context.memoryContent   = content;
    console.log(`[memory-bootstrap] Loaded MEMORY.md for group ${groupId}`);
  }
};

export default handler;
