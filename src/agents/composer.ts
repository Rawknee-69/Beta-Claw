import { encode, decode, parseAll } from '../core/toon-serializer.js';
import { PromptLoader } from '../core/prompt-loader.js';
import { getConfig } from '../core/config-loader.js';
import { classifyTier } from '../core/complexity-estimator.js';
import { selectModel } from '../core/model-selector.js';
import type { ProviderRegistry } from '../core/provider-registry.js';
import { DEFAULT_CATALOG, type ModelEntry } from '../core/model-catalog.js';
import type { AgentTask, AgentResult, IAgent } from './types.js';
import { AgentTaskSchema, AgentResultSchema } from './types.js';

function extractSubAgentSummaries(brief: string): string {
  const blocks = parseAll(brief);
  const sections: string[] = [];

  for (const block of blocks) {
    const d = block.data;
    if (typeof d['summary'] === 'string' && d['summary']) {
      sections.push(d['summary']);
    } else if (typeof d['content'] === 'string' && d['content']) {
      sections.push(d['content']);
    } else if (typeof d['stdout'] === 'string' && d['stdout']) {
      sections.push(`Output:\n${d['stdout']}`);
    } else if (typeof d['response'] === 'string' && d['response']) {
      sections.push(d['response']);
    }
  }

  return sections.length > 0 ? sections.join('\n\n') : brief;
}

export class ComposerAgent implements IAgent {
  readonly type = 'composer' as const;

  private static _registry: ProviderRegistry | null = null;
  private static _catalog: ModelEntry[] | null = null;

  static setRegistry(registry: ProviderRegistry): void {
    ComposerAgent._registry = registry;
  }

  static setCatalog(catalog: { getAllModels?: () => unknown[] } | ModelEntry[]): void {
    if (Array.isArray(catalog)) {
      ComposerAgent._catalog = catalog;
    } else {
      const available = new Set(ComposerAgent._registry?.listIds() ?? []);
      ComposerAgent._catalog = DEFAULT_CATALOG.filter(m => available.has(m.provider_id));
    }
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const validated = AgentTaskSchema.parse(task);
    const start = performance.now();
    const config = getConfig();

    let agentResults: string;
    let userRequest: string;

    const userAskedMatch = /User asked:\s*(.*?)(?:\nResearch:|$)/s.exec(validated.brief);
    if (userAskedMatch?.[1]) {
      userRequest = userAskedMatch[1].trim();
      agentResults = validated.brief.replace(/User asked:.*?\n/s, '');
    } else {
      userRequest = validated.brief;
      agentResults = extractSubAgentSummaries(validated.brief);
    }

    const registry = ComposerAgent._registry;
    const catalog = ComposerAgent._catalog;

    if (!registry || !catalog || registry.size() === 0) {
      const output = encode('composer_result', {
        response: agentResults || validated.brief,
        tokensUsed: 0,
        model: 'none',
      } as Record<string, unknown>);

      return {
        taskId: validated.id,
        agentType: this.type,
        output,
        tokensUsed: Math.ceil(output.length / 4),
        durationMs: performance.now() - start,
      };
    }

    const promptLoader = new PromptLoader();
    let composerPrompt: string;
    try {
      composerPrompt = await promptLoader.render('agents/composer.toon', {
        PERSONA_NAME: config.persona,
        PERSONA_STYLE: config.personaStyle,
        AGENT_RESULTS: agentResults,
        USER_REQUEST: userRequest,
      });
    } catch {
      composerPrompt = `You are ${config.persona}. Style: ${config.personaStyle}.\n` +
        `Synthesize these sub-agent results into a response:\n${agentResults}\n\n` +
        `User's request: ${userRequest}`;
    }

    void classifyTier(userRequest);
    const selection = selectModel(catalog, userRequest);

    if (!selection) {
      const output = encode('composer_result', {
        response: agentResults,
        tokensUsed: 0,
        model: 'none',
      } as Record<string, unknown>);

      return {
        taskId: validated.id,
        agentType: this.type,
        output,
        tokensUsed: Math.ceil(output.length / 4),
        durationMs: performance.now() - start,
      };
    }

    const provider = registry.get(selection.model.provider_id);
    if (!provider) {
      const output = encode('composer_result', {
        response: agentResults,
        tokensUsed: 0,
        model: 'unavailable',
      } as Record<string, unknown>);

      return {
        taskId: validated.id,
        agentType: this.type,
        output,
        tokensUsed: Math.ceil(output.length / 4),
        durationMs: performance.now() - start,
      };
    }

    const modelId = selection.model.id;

    try {
      const response = await provider.complete({
        model: modelId,
        messages: [
          { role: 'system', content: composerPrompt },
          { role: 'user', content: userRequest },
        ],
        maxTokens: 2048,
      });

      const output = encode('composer_result', {
        response: response.content,
        tokensUsed: response.usage.totalTokens,
        model: modelId,
      } as Record<string, unknown>);

      return {
        taskId: validated.id,
        agentType: this.type,
        output,
        tokensUsed: response.usage.totalTokens,
        durationMs: performance.now() - start,
      };
    } catch (err) {
      const fallback = agentResults || validated.brief;
      const output = encode('composer_result', {
        response: fallback,
        tokensUsed: 0,
        model: modelId,
        error: err instanceof Error ? err.message : String(err),
      } as Record<string, unknown>);

      return {
        taskId: validated.id,
        agentType: this.type,
        output,
        tokensUsed: Math.ceil(output.length / 4),
        durationMs: performance.now() - start,
      };
    }
  }

  async compose(results: AgentResult[], task: AgentTask): Promise<string> {
    const validated = AgentTaskSchema.parse(task);
    const validatedResults = results.map((r) => AgentResultSchema.parse(r));

    const sections: string[] = [];
    for (const result of validatedResults) {
      const parsed = decode(result.output);
      const data = parsed.data as Record<string, unknown>;
      let content: string;
      if (typeof data['summary'] === 'string') {
        content = data['summary'];
      } else if (typeof data['content'] === 'string') {
        content = data['content'];
      } else if (typeof data['stdout'] === 'string') {
        content = data['stdout'];
      } else {
        content = result.output;
      }
      if (content.length > 0) {
        sections.push(content);
      }
    }

    if (sections.length === 0) {
      return encode('response', {
        taskId: validated.id,
        content: 'No results available.',
        sources: [] as string[],
      } as Record<string, unknown>);
    }

    return encode('response', {
      taskId: validated.id,
      content: sections.join('\n\n'),
      sources: [] as string[],
    } as Record<string, unknown>);
  }
}

export { ComposerAgent as ResponseComposer };
