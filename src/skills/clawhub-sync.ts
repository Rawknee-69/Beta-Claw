import { fetchTopSkills, installSkill, isSafeToInstall } from './clawhub-client.js';
import { skillRegistry } from './skill-registry.js';

const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

let syncTimer: ReturnType<typeof setInterval> | null = null;

export function scheduleClawHubSync(): void {
  // Run once after a 30s delay
  setTimeout(() => { void syncClawHub(); }, 30_000);
  // Then every 24h (setInterval OK here — infra, not agent)
  syncTimer = setInterval(() => { void syncClawHub(); }, SYNC_INTERVAL_MS);
}

export function stopClawHubSync(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}

async function syncClawHub(): Promise<void> {
  try {
    console.log('[clawhub-sync] Checking for new skills...');
    const top = await fetchTopSkills(20);

    for (const skill of top) {
      if (skillRegistry.get(skill.slug)) continue;
      if (!isSafeToInstall(skill)) {
        console.log(`[clawhub-sync] Skipping suspicious skill: ${skill.slug}`);
        continue;
      }
      if (skill.downloads < 100) continue;

      const result = installSkill(skill.slug);
      if (result.ok) {
        console.log(`[clawhub-sync] Auto-installed: ${skill.slug}`);
      }
    }
  } catch (e) {
    console.warn('[clawhub-sync] Sync failed:', e);
  }
}
