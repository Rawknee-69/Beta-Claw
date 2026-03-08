import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from '../core/paths.js';

const CLAWHUB_BROWSE = 'https://clawhub.ai/skills?sort=downloads&nonSuspicious=true';
const CLAWHUB_API    = 'https://registry.clawhub.ai';

export interface ClawHubSkill {
  slug:        string;
  name:        string;
  description: string;
  downloads:   number;
  tags:        string[];
  version:     string;
  tarball?:    string;
}

/**
 * Fetch top skills from ClawHub registry API (nonSuspicious=true filter always on).
 */
export async function fetchTopSkills(limit = 20): Promise<ClawHubSkill[]> {
  try {
    const url = `${CLAWHUB_API}/v1/skills?sort=downloads&nonSuspicious=true&limit=${limit}`;
    const r   = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json() as { skills?: ClawHubSkill[] };
    return data.skills ?? [];
  } catch (e) {
    console.warn('[clawhub] API fetch failed, falling back to web scrape:', e);
    return scrapeClawHub(limit);
  }
}

async function scrapeClawHub(limit: number): Promise<ClawHubSkill[]> {
  try {
    const r = await fetch(CLAWHUB_BROWSE);
    const html = await r.text();
    const slugs = [...new Set(
      [...html.matchAll(/href="\/skills\/([a-z0-9-]+)"/gi)]
        .map(m => m[1])
        .filter((s): s is string => Boolean(s)),
    )].slice(0, limit);
    return slugs.map(slug => ({ slug, name: slug, description: '', downloads: 0, tags: [], version: 'latest' }));
  } catch {
    return [];
  }
}

/**
 * Download and extract a skill by slug into skills/.
 * Uses curl + tar/unzip — no clawhub CLI needed.
 * The skill-watcher will auto-detect and convert it.
 */
export function installSkill(slug: string): { ok: boolean; message: string } {
  const skillsDir = path.resolve(PATHS.skills);
  const destDir   = path.join(skillsDir, slug);

  if (fs.existsSync(destDir)) {
    return { ok: false, message: `Skill "${slug}" already exists at ${destDir}` };
  }

  fs.mkdirSync(skillsDir, { recursive: true });

  // Try .tar.gz first, then .zip
  const tarballUrl = `${CLAWHUB_API}/v1/skills/${slug}/download`;
  const tmpTar     = `/tmp/clawhub-${slug}-${Date.now()}.tar.gz`;
  const tmpZip     = `/tmp/clawhub-${slug}-${Date.now()}.zip`;
  const tmpDir     = `/tmp/clawhub-${slug}-${Date.now()}`;

  // Download the archive
  const dl = spawnSync('curl', [
    '-fsSL', '-o', tmpTar,
    '-H', 'Accept: application/gzip',
    tarballUrl,
  ], { encoding: 'utf-8', timeout: 60_000 });

  if (dl.status === 0 && fs.existsSync(tmpTar) && fs.statSync(tmpTar).size > 0) {
    // Extract tarball
    fs.mkdirSync(tmpDir, { recursive: true });
    const ext = spawnSync('tar', ['xzf', tmpTar, '-C', tmpDir], {
      encoding: 'utf-8', timeout: 30_000,
    });

    cleanup(tmpTar);

    if (ext.status !== 0) {
      cleanup(tmpDir);
      return { ok: false, message: `Failed to extract tarball: ${ext.stderr?.trim() ?? 'unknown error'}` };
    }

    return moveExtracted(tmpDir, destDir, slug);
  }

  // Fallback: try .zip
  cleanup(tmpTar);
  const dlZip = spawnSync('curl', [
    '-fsSL', '-o', tmpZip,
    '-H', 'Accept: application/zip',
    tarballUrl,
  ], { encoding: 'utf-8', timeout: 60_000 });

  if (dlZip.status === 0 && fs.existsSync(tmpZip) && fs.statSync(tmpZip).size > 0) {
    fs.mkdirSync(tmpDir, { recursive: true });
    const ext = spawnSync('unzip', ['-o', tmpZip, '-d', tmpDir], {
      encoding: 'utf-8', timeout: 30_000,
    });

    cleanup(tmpZip);

    if (ext.status !== 0) {
      cleanup(tmpDir);
      return { ok: false, message: `Failed to extract zip: ${ext.stderr?.trim() ?? 'unknown error'}` };
    }

    return moveExtracted(tmpDir, destDir, slug);
  }

  cleanup(tmpTar, tmpZip, tmpDir);
  return { ok: false, message: `Failed to download skill "${slug}" from ${tarballUrl}` };
}

/**
 * Move extracted content into the final skills/ destination.
 * Handles both flat and nested archive structures.
 */
function moveExtracted(tmpDir: string, destDir: string, slug: string): { ok: boolean; message: string } {
  try {
    const entries = fs.readdirSync(tmpDir, { withFileTypes: true });

    // If the archive contained a single directory, use its contents
    if (entries.length === 1 && entries[0]!.isDirectory()) {
      const innerDir = path.join(tmpDir, entries[0]!.name);
      fs.renameSync(innerDir, destDir);
    } else {
      fs.renameSync(tmpDir, destDir);
    }

    // Verify SKILL.md exists
    const skillMd = path.join(destDir, 'SKILL.md');
    if (!fs.existsSync(skillMd)) {
      console.warn(`[clawhub] Warning: ${slug} has no SKILL.md — may need manual setup`);
    }

    cleanup(tmpDir);
    return { ok: true, message: `Installed ${slug} → skills/${slug}/. Skill-watcher will auto-convert if needed.` };
  } catch (e) {
    cleanup(tmpDir);
    return { ok: false, message: `Failed to move extracted skill: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function cleanup(...paths: string[]): void {
  for (const p of paths) {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

/**
 * Returns true if the skill looks safe enough to auto-install.
 */
export function isSafeToInstall(skill: ClawHubSkill): boolean {
  const suspicious = [
    'password', 'credential', 'keylogger', 'exfil', 'reverse shell',
    'backdoor', 'rootkit', 'miner', 'cryptominer', 'c2', 'command and control',
  ];
  const text = `${skill.name} ${skill.description} ${skill.tags.join(' ')}`.toLowerCase();
  return !suspicious.some(s => text.includes(s));
}
