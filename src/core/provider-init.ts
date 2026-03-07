/**
 * Shared provider registration used by both the chat command and daemon.
 * Reads API keys from environment variables and registers all available providers.
 */
import { ProviderRegistry } from './provider-registry.js';
import { OpenRouterAdapter } from '../providers/openrouter.js';
import { AnthropicAdapter } from '../providers/anthropic.js';
import { OpenAIAdapter } from '../providers/openai.js';
import { GoogleAdapter } from '../providers/google.js';
import { GroqAdapter } from '../providers/groq.js';
import { MistralAdapter } from '../providers/mistral.js';
import { CohereAdapter } from '../providers/cohere.js';
import { TogetherAdapter } from '../providers/together.js';
import { DeepSeekAdapter } from '../providers/deepseek.js';
import { PerplexityAdapter } from '../providers/perplexity.js';
import { OllamaAdapter } from '../providers/ollama.js';
import { LMStudioAdapter } from '../providers/lmstudio.js';

interface ProviderSpec {
  envVar: string;
  name: string;
  id: string;
  create: (getKey: () => string) => InstanceType<typeof OpenRouterAdapter>
    | InstanceType<typeof AnthropicAdapter>
    | InstanceType<typeof OpenAIAdapter>
    | InstanceType<typeof GoogleAdapter>
    | InstanceType<typeof GroqAdapter>
    | InstanceType<typeof MistralAdapter>
    | InstanceType<typeof CohereAdapter>
    | InstanceType<typeof TogetherAdapter>
    | InstanceType<typeof DeepSeekAdapter>
    | InstanceType<typeof PerplexityAdapter>;
}

const PROVIDER_ENV_MAP: ProviderSpec[] = [
  { envVar: 'OPENROUTER_API_KEY', name: 'OpenRouter',   id: 'openrouter', create: (g) => new OpenRouterAdapter(g) },
  { envVar: 'ANTHROPIC_API_KEY',  name: 'Anthropic',    id: 'anthropic',  create: (g) => new AnthropicAdapter(g) },
  { envVar: 'OPENAI_API_KEY',     name: 'OpenAI',       id: 'openai',     create: (g) => new OpenAIAdapter(g) },
  { envVar: 'GOOGLE_API_KEY',     name: 'Google Gemini',id: 'google',     create: (g) => new GoogleAdapter(g) },
  { envVar: 'GROQ_API_KEY',       name: 'Groq',         id: 'groq',       create: (g) => new GroqAdapter(g) },
  { envVar: 'MISTRAL_API_KEY',    name: 'Mistral',      id: 'mistral',    create: (g) => new MistralAdapter(g) },
  { envVar: 'COHERE_API_KEY',     name: 'Cohere',       id: 'cohere',     create: (g) => new CohereAdapter(g) },
  { envVar: 'TOGETHER_API_KEY',   name: 'Together AI',  id: 'together',   create: (g) => new TogetherAdapter(g) },
  { envVar: 'DEEPSEEK_API_KEY',   name: 'DeepSeek',     id: 'deepseek',   create: (g) => new DeepSeekAdapter(g) },
  { envVar: 'PERPLEXITY_API_KEY', name: 'Perplexity',   id: 'perplexity', create: (g) => new PerplexityAdapter(g) },
];

export function registerAvailableProviders(registry: ProviderRegistry): string[] {
  const registered: string[] = [];

  for (const entry of PROVIDER_ENV_MAP) {
    const key = process.env[entry.envVar];
    if (key) {
      const envVar = entry.envVar;
      registry.register(entry.create(() => {
        const k = process.env[envVar];
        if (!k) throw new Error(`${envVar} not set`);
        return k;
      }));
      registered.push(entry.name);
    }
  }

  try {
    registry.register(new OllamaAdapter());
    registered.push('Ollama (local)');
  } catch {
    // Ollama not available
  }

  try {
    registry.register(new LMStudioAdapter());
    registered.push('LM Studio (local)');
  } catch {
    // LM Studio not available
  }

  return registered;
}
