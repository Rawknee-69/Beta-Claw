import { parseAll } from './toon-serializer.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AgentMetric {
  agent: string;
  durationMs: number;
  tokensUsed: number;
}

export interface TurnMetrics {
  turnNumber: number;
  totalMs: number;
  planMs: number;
  agentMetrics: AgentMetric[];
  modelId: string;
  complexityScore: number;
  complexityTier: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUSD: number;
  memoryUtilization: number;
  memoryTokens: number;
  memoryMaxTokens: number;
  heapUsedMB: number;
  rssMB: number;
  filesCreated: string[];
  guardrailEvents: number;
}

export interface SessionMetrics {
  turns: number;
  totalTokens: number;
  totalCostUSD: number;
  totalDurationMs: number;
  avgTurnMs: number;
  peakHeapMB: number;
  peakRssMB: number;
  filesCreated: number;
  guardrailBlocks: number;
  agentCalls: Record<string, { count: number; totalMs: number; totalTokens: number }>;
}

export interface ToonBenchmarkResult {
  name: string;
  tokensJson: number;
  tokensToon: number;
  savingsPercent: number;
}

// ── Extraction helpers ───────────────────────────────────────────────────────

export function extractTokensFromOutput(toonOrText: string): { input: number; output: number; total: number } {
  try {
    const blocks = parseAll(toonOrText);
    for (const block of blocks) {
      const d = block.data;
      const total = typeof d['tokensUsed'] === 'number' ? d['tokensUsed'] : 0;
      return { input: 0, output: 0, total };
    }
  } catch { /* not TOON */ }
  return { input: 0, output: 0, total: 0 };
}

export function extractFilesCreated(toonOrText: string): string[] {
  try {
    const blocks = parseAll(toonOrText);
    for (const block of blocks) {
      const d = block.data;
      if (Array.isArray(d['filesCreated'])) {
        return (d['filesCreated'] as unknown[]).map(String).filter(f => f.length > 0);
      }
    }
  } catch { /* not TOON */ }
  return [];
}

// ── Cost calculation ─────────────────────────────────────────────────────────

export function estimateCostUSD(
  tokens: number,
  inputCostPer1M: number | null,
  outputCostPer1M: number | null,
): number {
  if (tokens <= 0) return 0;
  const avgCostPer1M = ((inputCostPer1M ?? 0) + (outputCostPer1M ?? 0)) / 2;
  return (tokens / 1_000_000) * avgCostPer1M;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function formatCost(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.0001) return `$${usd.toExponential(1)}`;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60_000).toFixed(1)}min`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function buildBar(percent: number, width: number): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  const color = clamped > 85 ? '\x1b[31m' : clamped > 60 ? '\x1b[33m' : '\x1b[32m';
  return `${color}${'█'.repeat(filled)}${'░'.repeat(empty)}\x1b[0m`;
}

// ── Display ──────────────────────────────────────────────────────────────────

const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const MAGENTA = '\x1b[35m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';
const BAR = '\x1b[90m│\x1b[0m';
const BOLD = '\x1b[1m';

export function printTurnMetrics(m: TurnMetrics): void {
  const memBar = buildBar(m.memoryUtilization, 20);
  const agentLine = m.agentMetrics
    .map(a => `${a.agent}:${formatDuration(a.durationMs)}`)
    .join('  ');

  console.log(`${DIM}┌─────────────────────────────────────────────────────────────┐${RESET}`);
  console.log(`${BAR} ${CYAN}Turn ${m.turnNumber}${RESET}  ${DIM}${m.modelId}${RESET}  ${DIM}complexity:${RESET}${m.complexityScore}/${m.complexityTier}`);
  console.log(`${BAR} ${YELLOW}Time${RESET}  total:${formatDuration(m.totalMs)}  plan:${formatDuration(m.planMs)}  ${DIM}${agentLine}${RESET}`);

  if (m.totalTokens > 0) {
    console.log(`${BAR} ${GREEN}Tokens${RESET}  in:${m.inputTokens}  out:${m.outputTokens}  total:${m.totalTokens}  ${DIM}cost:${formatCost(m.estimatedCostUSD)}${RESET}`);
  }

  console.log(`${BAR} ${MAGENTA}Memory${RESET}  ${memBar} ${Math.round(m.memoryUtilization)}%  ${DIM}${m.memoryTokens}/${m.memoryMaxTokens} tok${RESET}  ${DIM}heap:${m.heapUsedMB}MB  rss:${m.rssMB}MB${RESET}`);

  if (m.filesCreated.length > 0) {
    console.log(`${BAR} ${CYAN}Files${RESET}  ${m.filesCreated.join(', ')}`);
  }
  if (m.guardrailEvents > 0) {
    console.log(`${BAR} ${YELLOW}Guardrails${RESET}  ${m.guardrailEvents} event(s) flagged`);
  }

  console.log(`${DIM}└─────────────────────────────────────────────────────────────┘${RESET}`);
}

export function printSessionSummary(s: SessionMetrics): void {
  console.log(`\n${DIM}╔═══════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${DIM}║${RESET} ${BOLD}${CYAN}Session Summary${RESET}                                              ${DIM}║${RESET}`);
  console.log(`${DIM}╠═══════════════════════════════════════════════════════════════╣${RESET}`);
  console.log(`${DIM}║${RESET} ${YELLOW}Turns${RESET}        ${String(s.turns).padEnd(8)} ${DIM}avg:${formatDuration(s.avgTurnMs)}/turn${RESET}`.padEnd(72) + `${DIM}║${RESET}`);
  console.log(`${DIM}║${RESET} ${GREEN}Tokens${RESET}       ${String(s.totalTokens).padEnd(8)} ${DIM}cost:${formatCost(s.totalCostUSD)}${RESET}`.padEnd(72) + `${DIM}║${RESET}`);
  console.log(`${DIM}║${RESET} ${YELLOW}Duration${RESET}     ${formatDuration(s.totalDurationMs)}`.padEnd(63) + `${DIM}║${RESET}`);
  console.log(`${DIM}║${RESET} ${MAGENTA}Peak Memory${RESET}  heap:${s.peakHeapMB}MB  rss:${s.peakRssMB}MB`.padEnd(63) + `${DIM}║${RESET}`);

  if (s.filesCreated > 0) {
    console.log(`${DIM}║${RESET} ${CYAN}Files${RESET}        ${s.filesCreated} created`.padEnd(63) + `${DIM}║${RESET}`);
  }
  if (s.guardrailBlocks > 0) {
    console.log(`${DIM}║${RESET} ${RED}Guardrails${RESET}   ${s.guardrailBlocks} blocked`.padEnd(63) + `${DIM}║${RESET}`);
  }

  const agentEntries = Object.entries(s.agentCalls);
  if (agentEntries.length > 0) {
    console.log(`${DIM}╟───────────────────────────────────────────────────────────────╢${RESET}`);
    console.log(`${DIM}║${RESET} ${BOLD}Agent Breakdown${RESET}`.padEnd(63) + `${DIM}║${RESET}`);
    for (const [agent, data] of agentEntries) {
      const line = `  ${agent.padEnd(12)} ${String(data.count).padEnd(3)}calls  ${formatDuration(data.totalMs).padEnd(10)} ${data.totalTokens} tok`;
      console.log(`${DIM}║${RESET}${line}`.padEnd(63) + `${DIM}║${RESET}`);
    }
  }

  console.log(`${DIM}╚═══════════════════════════════════════════════════════════════╝${RESET}`);
}

// ── Session accumulator ──────────────────────────────────────────────────────

export class MetricsCollector {
  private turns: TurnMetrics[] = [];
  private peakHeapMB = 0;
  private peakRssMB = 0;
  private guardrailBlocks = 0;

  recordTurn(m: TurnMetrics): void {
    this.turns.push(m);
    if (m.heapUsedMB > this.peakHeapMB) this.peakHeapMB = m.heapUsedMB;
    if (m.rssMB > this.peakRssMB) this.peakRssMB = m.rssMB;
  }

  recordBlock(): void {
    this.guardrailBlocks++;
  }

  getSessionMetrics(): SessionMetrics {
    const totalTokens = this.turns.reduce((s, t) => s + t.totalTokens, 0);
    const totalCostUSD = this.turns.reduce((s, t) => s + t.estimatedCostUSD, 0);
    const totalDurationMs = this.turns.reduce((s, t) => s + t.totalMs, 0);
    const totalFiles = this.turns.reduce((s, t) => s + t.filesCreated.length, 0);
    const totalGuardrailEvents = this.turns.reduce((s, t) => s + t.guardrailEvents, 0);

    const agentCalls: Record<string, { count: number; totalMs: number; totalTokens: number }> = {};
    for (const turn of this.turns) {
      for (const am of turn.agentMetrics) {
        const existing = agentCalls[am.agent];
        if (existing) {
          existing.count++;
          existing.totalMs += am.durationMs;
          existing.totalTokens += am.tokensUsed;
        } else {
          agentCalls[am.agent] = { count: 1, totalMs: am.durationMs, totalTokens: am.tokensUsed };
        }
      }
    }

    return {
      turns: this.turns.length,
      totalTokens,
      totalCostUSD,
      totalDurationMs,
      avgTurnMs: this.turns.length > 0 ? totalDurationMs / this.turns.length : 0,
      peakHeapMB: this.peakHeapMB,
      peakRssMB: this.peakRssMB,
      filesCreated: totalFiles,
      guardrailBlocks: this.guardrailBlocks + totalGuardrailEvents,
      agentCalls,
    };
  }

  getTurnCount(): number {
    return this.turns.length;
  }
}

// ── TOON benchmark data ──────────────────────────────────────────────────────

export function runToonBenchmark(): ToonBenchmarkResult[] {
  const testCases = [
    { name: 'Simple object',   json: '{"name":"Alice","age":30,"active":true}', toon: '@user{ name:Alice age:30 active:true }' },
    { name: 'Nested object',   json: '{"user":{"name":"Bob","settings":{"theme":"dark","lang":"en"}}}', toon: '@user{ name:Bob settings:@cfg{ theme:dark lang:en } }' },
    { name: 'Array data',      json: '{"items":["alpha","beta","gamma","delta"]}', toon: '@data{ items:[alpha, beta, gamma, delta] }' },
    { name: 'Tool call',       json: '{"tool":"search","args":{"query":"latest news","limit":10}}', toon: '@tool{ name:search query:latest news limit:10 }' },
    { name: 'Agent result',    json: '{"taskId":"abc","agentType":"research","output":"found 3 results","tokensUsed":150,"durationMs":312}', toon: '@result{ taskId:abc agent:research output:found 3 results tokens:150 ms:312 }' },
    { name: 'Exec result',     json: '{"command":"write index.html","exitCode":0,"stdout":"Created index.html (3578 bytes)","filesCreated":["index.html"]}', toon: '@exec_result{ cmd:write index.html exit:0 stdout:Created index.html (3578 bytes) files:[index.html] }' },
    { name: 'Completion req',  json: '{"model":"gemini-flash","messages":[{"role":"system","content":"You are helpful"},{"role":"user","content":"Hello"}],"maxTokens":2048}', toon: '@req{ model:gemini-flash maxTokens:2048 sys:You are helpful user:Hello }' },
  ];

  return testCases.map(tc => {
    const tokensJson = estimateTokens(tc.json);
    const tokensToon = estimateTokens(tc.toon);
    const savingsPercent = tokensJson > 0 ? ((tokensJson - tokensToon) / tokensJson) * 100 : 0;
    return { name: tc.name, tokensJson, tokensToon, savingsPercent };
  });
}

// ── Complexity benchmark ─────────────────────────────────────────────────────

export interface ComplexityBenchmarkResult {
  input: string;
  score: number;
  tier: string;
  estimatorMs: number;
}

export function runComplexityBenchmark(
  estimator: (input: string) => { score: number; tier: string },
): ComplexityBenchmarkResult[] {
  const inputs = [
    'hi',
    'what is 2 + 2',
    'build a coffee website',
    'search for the latest news about AI and summarize the top 5 results',
    'create a python script that reads a CSV file, analyzes sales data by region, generates charts, and exports a PDF report',
    'debug the authentication flow — users are getting 403 errors after token refresh on the mobile app but not web',
  ];

  return inputs.map(input => {
    const start = performance.now();
    const iterations = 10_000;
    let result = { score: 0, tier: '' };
    for (let i = 0; i < iterations; i++) {
      result = estimator(input);
    }
    const totalMs = performance.now() - start;
    return {
      input: input.length > 60 ? input.slice(0, 57) + '...' : input,
      score: result.score,
      tier: result.tier,
      estimatorMs: totalMs / iterations,
    };
  });
}

// ── Agent pipeline benchmark ─────────────────────────────────────────────────

export interface PipelineBenchmarkResult {
  step: string;
  durationMs: number;
  tokensUsed: number;
}
