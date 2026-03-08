export interface SuspicionResult {
  score:   number;
  reasons: string[];
  blocked: boolean;
  askUser: boolean;
}

interface SuspicionRule {
  pattern: RegExp;
  weight:  number;
  reason:  string;
  block?:  boolean;
}

const RULES: SuspicionRule[] = [
  // Hard blocks
  { pattern: /rm\s+-rf\s+\/[^t]/,       weight: 100, reason: 'Deletes root filesystem', block: true },
  { pattern: /mkfs/,                     weight: 100, reason: 'Formats a disk', block: true },
  { pattern: /dd\s+if=\/dev\/zero/,      weight: 100, reason: 'Overwrites disk with zeros', block: true },
  { pattern: />\s*\/dev\/sd/,            weight: 100, reason: 'Writes directly to disk device', block: true },
  { pattern: /fork\s*bomb|:\(\)\{/,      weight: 100, reason: 'Fork bomb detected', block: true },
  { pattern: /curl\s+.*\|\s*(ba)?sh/,    weight: 80,  reason: 'Pipes curl output directly to shell' },
  { pattern: /wget\s+.*\|\s*(ba)?sh/,    weight: 80,  reason: 'Pipes wget output directly to shell' },
  // High suspicion
  { pattern: /nc\s+-[le]/,               weight: 70,  reason: 'Netcat listener (possible reverse shell)' },
  { pattern: /\/dev\/tcp\//,             weight: 70,  reason: 'Bash TCP redirect (possible reverse shell)' },
  { pattern: /base64\s+-d\s*\|/,         weight: 65,  reason: 'Decodes and executes base64 payload' },
  { pattern: /chmod\s+[0-9]*7\s+/,       weight: 60,  reason: 'Makes file world-executable' },
  { pattern: /sudo\s+/,                  weight: 55,  reason: 'Elevated privileges requested' },
  { pattern: /crontab\s+-r/,             weight: 60,  reason: 'Removes all cron jobs' },
  { pattern: /passwd|shadow/,            weight: 65,  reason: 'Accesses credential files' },
  { pattern: /\.ssh\/authorized/,        weight: 70,  reason: 'Modifies SSH authorized keys' },
  { pattern: /iptables\s+-F/,            weight: 65,  reason: 'Flushes firewall rules' },
  { pattern: /cryptominer|xmrig|monero/, weight: 90,  reason: 'Cryptominer pattern' },
  { pattern: /exfil|exfiltrat/i,         weight: 85,  reason: 'Data exfiltration pattern' },
  // Medium suspicion
  { pattern: /curl\s+-s\s+http/,         weight: 35,  reason: 'Silent HTTP fetch (verify intent)' },
  { pattern: /pkill|killall/,            weight: 40,  reason: 'Kills processes by name' },
  { pattern: /history\s+-c/,             weight: 45,  reason: 'Clears shell history' },
  { pattern: /shred\s+/,                 weight: 50,  reason: 'Securely deletes files' },
];

export function scoreSuspicion(cmd: string): SuspicionResult {
  let score = 0;
  const reasons: string[] = [];
  let blocked = false;

  for (const rule of RULES) {
    if (rule.pattern.test(cmd)) {
      score = Math.min(100, score + rule.weight);
      reasons.push(rule.reason);
      if (rule.block) blocked = true;
    }
  }

  return {
    score,
    reasons,
    blocked,
    askUser: !blocked && score >= 50,
  };
}

export function formatSuspicionWarning(cmd: string, result: SuspicionResult): string {
  return [
    `⚠️ Suspicious command detected (risk score: ${result.score}/100)`,
    `Command: \`${cmd.slice(0, 200)}\``,
    `Reasons: ${result.reasons.join(', ')}`,
    result.blocked
      ? '🚫 This command is BLOCKED and will not run.'
      : 'Do you want to run this? Reply YES to confirm or NO to cancel.',
  ].join('\n');
}
