import path from 'path';
import fs from 'fs';
import { PATHS } from '../core/paths.js';

export interface MultimodalCapabilities {
  canGenerateImage: boolean;
  canGenerateAudio: boolean;
  imageProvider:    'gemini' | 'openai' | 'stability' | null;
  audioProvider:    'gemini' | 'openai' | 'elevenlabs' | null;
}

const IMAGE_CAPABLE_MODELS = new Set([
  'gemini-3.1-pro-preview', 'gemini-3-pro-image-preview',
  'gemini-2.5-flash-image', 'gemini-2.5-pro', 'gemini-2.5-flash',
  'gemini-2.0-flash-exp',
]);
const AUDIO_CAPABLE_MODELS = new Set(['gemini-3.1-pro-preview']);

const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';

export function getCapabilities(modelId: string): MultimodalCapabilities {
  const hasGoogle     = Boolean(process.env['GOOGLE_API_KEY']);
  const hasOpenAI     = Boolean(process.env['OPENAI_API_KEY']);
  const hasElevenLabs = Boolean(process.env['ELEVENLABS_API_KEY']);
  const hasStability  = Boolean(process.env['STABILITY_API_KEY']);

  const canGeminiImage = (IMAGE_CAPABLE_MODELS.has(modelId) || hasGoogle) && hasGoogle;

  return {
    canGenerateImage: canGeminiImage || hasOpenAI || hasStability,
    canGenerateAudio: AUDIO_CAPABLE_MODELS.has(modelId) || hasOpenAI || hasElevenLabs,
    imageProvider:    canGeminiImage ? 'gemini'
                    : hasOpenAI ? 'openai'
                    : hasStability ? 'stability'
                    : null,
    audioProvider:    AUDIO_CAPABLE_MODELS.has(modelId) ? 'gemini'
                    : hasElevenLabs ? 'elevenlabs'
                    : hasOpenAI ? 'openai'
                    : null,
  };
}

type ImageResult = { filePath: string; mimeType: string };

async function tryGeminiImage(prompt: string, outDir: string): Promise<ImageResult | null> {
  const apiKey = process.env['GOOGLE_API_KEY'];
  if (!apiKey) return null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `Generate an image: ${prompt}` }] }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
    }),
  });

  if (!r.ok) return null;

  const data = await r.json() as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          inlineData?: { mimeType: string; data: string };
        }>;
      };
    }>;
  };

  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const imgPart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));
  if (!imgPart?.inlineData?.data) return null;

  const mime = imgPart.inlineData.mimeType;
  const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png';
  const filePath = path.join(outDir, `img-${Date.now()}.${ext}`);
  fs.writeFileSync(filePath, Buffer.from(imgPart.inlineData.data, 'base64'));
  return { filePath, mimeType: mime };
}

async function tryOpenAIImage(prompt: string, outDir: string): Promise<ImageResult | null> {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) return null;

  const outPath = path.join(outDir, `img-${Date.now()}.png`);
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size: '1024x1024', response_format: 'b64_json' }),
  });
  const data = await r.json() as { data?: Array<{ b64_json?: string }> };
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) return null;
  fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
  return { filePath: outPath, mimeType: 'image/png' };
}

async function tryStabilityImage(prompt: string, outDir: string): Promise<ImageResult | null> {
  const apiKey = process.env['STABILITY_API_KEY'];
  if (!apiKey) return null;

  const outPath = path.join(outDir, `img-${Date.now()}.png`);
  const r = await fetch('https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text_prompts: [{ text: prompt, weight: 1 }], cfg_scale: 7, height: 1024, width: 1024, steps: 30, samples: 1 }),
  });
  const data = await r.json() as { artifacts?: Array<{ base64?: string }> };
  const b64 = data.artifacts?.[0]?.base64;
  if (!b64) return null;
  fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
  return { filePath: outPath, mimeType: 'image/png' };
}

export async function generateImage(prompt: string, modelId: string, groupId: string): Promise<ImageResult | null> {
  const caps = getCapabilities(modelId);
  if (!caps.canGenerateImage) return null;

  const outDir = path.join(PATHS.workspaces, groupId, 'media');
  fs.mkdirSync(outDir, { recursive: true });

  type TryFn = (prompt: string, outDir: string) => Promise<ImageResult | null>;
  const providers: Array<{ id: typeof caps.imageProvider; fn: TryFn }> = [
    { id: 'gemini',    fn: tryGeminiImage },
    { id: 'openai',    fn: tryOpenAIImage },
    { id: 'stability', fn: tryStabilityImage },
  ];

  // Primary provider first, then fallbacks
  const ordered = [
    ...providers.filter(p => p.id === caps.imageProvider),
    ...providers.filter(p => p.id !== caps.imageProvider),
  ];

  for (const { fn } of ordered) {
    try {
      const result = await fn(prompt, outDir);
      if (result) return result;
    } catch { /* try next provider */ }
  }

  return null;
}

export async function generateAudio(text: string, modelId: string, groupId: string, voice?: string): Promise<{ filePath: string; mimeType: 'audio/mpeg' } | null> {
  const caps = getCapabilities(modelId);
  if (!caps.canGenerateAudio) return null;

  const outDir  = path.join(PATHS.workspaces, groupId, 'media');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `voice-${Date.now()}.mp3`);

  if (caps.audioProvider === 'elevenlabs') {
    const apiKey  = process.env['ELEVENLABS_API_KEY']!;
    const voiceId = voice ?? '21m00Tcm4TlvDq8ikWAM';
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_monolingual_v1', voice_settings: { stability: 0.5, similarity_boost: 0.5 } }),
    });
    if (!r.ok) return null;
    fs.writeFileSync(outPath, Buffer.from(await r.arrayBuffer()));
    return { filePath: outPath, mimeType: 'audio/mpeg' };
  }

  if (caps.audioProvider === 'openai') {
    const apiKey = process.env['OPENAI_API_KEY']!;
    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tts-1', input: text, voice: voice ?? 'nova' }),
    });
    if (!r.ok) return null;
    fs.writeFileSync(outPath, Buffer.from(await r.arrayBuffer()));
    return { filePath: outPath, mimeType: 'audio/mpeg' };
  }

  return null;
}
