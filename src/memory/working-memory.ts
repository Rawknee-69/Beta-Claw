import { z } from 'zod';
import { encode, decode } from '../core/toon-serializer.js';

type ResourceProfile = 'micro' | 'lite' | 'standard' | 'full';

interface WorkingMemoryConfig {
  maxTokens: number;
  summarizeThreshold: number;
  profile: ResourceProfile;
}

interface ContextBudget {
  systemTokens: number;
  summaryTokens: number;
  toolResultTokens: number;
  messageTokens: number;
  ragTokens: number;
  totalTokens: number;
  maxTokens: number;
  utilizationPercent: number;
}

interface MemoryMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  tokenEstimate: number;
}

const PROFILE_LIMITS: Record<ResourceProfile, number> = {
  micro: 2048,
  lite: 4096,
  standard: 8192,
  full: 128000,
};

const ExternalMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  timestamp: z.number().optional(),
  tokenEstimate: z.number().optional(),
});

const ExternalConfigSchema = z.object({
  maxTokens: z.number().positive().optional(),
  summarizeThreshold: z.number().min(0).max(1).optional(),
  profile: z.enum(['micro', 'lite', 'standard', 'full']).optional(),
});

const DEFAULT_PROFILE: ResourceProfile = 'standard';
const DEFAULT_THRESHOLD = 0.85;
const CHARS_PER_TOKEN = 4;

class WorkingMemory {
  private readonly config: WorkingMemoryConfig;
  private messages: MemoryMessage[] = [];
  private systemTokens = 0;
  private summaryTokens = 0;
  private toolResultTokens = 0;
  private ragTokens = 0;

  constructor(config?: Partial<WorkingMemoryConfig>) {
    if (config) {
      const validated = ExternalConfigSchema.parse(config);
      const profile = validated.profile ?? DEFAULT_PROFILE;
      this.config = {
        maxTokens: validated.maxTokens ?? PROFILE_LIMITS[profile],
        summarizeThreshold: validated.summarizeThreshold ?? DEFAULT_THRESHOLD,
        profile,
      };
    } else {
      this.config = {
        maxTokens: PROFILE_LIMITS[DEFAULT_PROFILE],
        summarizeThreshold: DEFAULT_THRESHOLD,
        profile: DEFAULT_PROFILE,
      };
    }
  }

  addMessage(role: 'user' | 'assistant' | 'system', content: string): void {
    const tokenEstimate = this.estimateTokens(content);
    const message: MemoryMessage = {
      role,
      content,
      timestamp: Date.now(),
      tokenEstimate,
    };
    this.messages.push(message);
  }

  getMessages(): MemoryMessage[] {
    return [...this.messages];
  }

  getBudget(): ContextBudget {
    const messageTokens = this.messages.reduce((sum, m) => sum + m.tokenEstimate, 0);
    const totalTokens = this.systemTokens + this.summaryTokens + this.toolResultTokens + messageTokens + this.ragTokens;
    const maxTokens = this.config.maxTokens;
    const utilizationPercent = maxTokens > 0 ? (totalTokens / maxTokens) * 100 : 0;

    return {
      systemTokens: this.systemTokens,
      summaryTokens: this.summaryTokens,
      toolResultTokens: this.toolResultTokens,
      messageTokens,
      ragTokens: this.ragTokens,
      totalTokens,
      maxTokens,
      utilizationPercent,
    };
  }

  setSystemTokens(tokens: number): void {
    this.systemTokens = tokens;
  }

  setSummaryTokens(tokens: number): void {
    this.summaryTokens = tokens;
  }

  setRagTokens(tokens: number): void {
    this.ragTokens = tokens;
  }

  needsSummarization(): boolean {
    const budget = this.getBudget();
    return budget.utilizationPercent >= this.config.summarizeThreshold * 100;
  }

  getMessagesForSummarization(): MemoryMessage[] {
    if (!this.needsSummarization()) {
      return [];
    }
    const halfCount = Math.ceil(this.messages.length / 2);
    return this.messages.slice(0, halfCount);
  }

  applySummarization(summary: string, summarizedCount: number): void {
    if (summarizedCount <= 0 || summarizedCount > this.messages.length) {
      return;
    }
    this.messages = this.messages.slice(summarizedCount);
    const summaryTokens = this.estimateTokens(summary);
    this.summaryTokens = summaryTokens;
  }

  clear(): void {
    this.messages = [];
    this.systemTokens = 0;
    this.summaryTokens = 0;
    this.toolResultTokens = 0;
    this.ragTokens = 0;
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  toToon(): string {
    const messagesData = this.messages.map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      tokenEstimate: m.tokenEstimate,
    }));

    return encode('working-memory', {
      profile: this.config.profile,
      maxTokens: this.config.maxTokens,
      threshold: this.config.summarizeThreshold,
      messageCount: this.messages.length,
      messages: messagesData,
    });
  }

  static fromToon(toon: string): WorkingMemory {
    const parsed = decode(toon);
    const data = parsed.data;

    const profile = String(data['profile'] ?? DEFAULT_PROFILE) as ResourceProfile;
    const maxTokens = Number(data['maxTokens'] ?? PROFILE_LIMITS[profile]);
    const threshold = Number(data['threshold'] ?? DEFAULT_THRESHOLD);

    const mem = new WorkingMemory({ profile, maxTokens, summarizeThreshold: threshold });

    const rawMessages = data['messages'];
    if (Array.isArray(rawMessages)) {
      for (const raw of rawMessages) {
        if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
          const validated = ExternalMessageSchema.parse(raw);
          const msg: MemoryMessage = {
            role: validated.role,
            content: validated.content,
            timestamp: validated.timestamp ?? Date.now(),
            tokenEstimate: validated.tokenEstimate ?? mem.estimateTokens(validated.content),
          };
          mem.messages.push(msg);
        }
      }
    }

    return mem;
  }
}

export { WorkingMemory, PROFILE_LIMITS, ExternalMessageSchema, ExternalConfigSchema };
export type { ResourceProfile, WorkingMemoryConfig, ContextBudget, MemoryMessage };
