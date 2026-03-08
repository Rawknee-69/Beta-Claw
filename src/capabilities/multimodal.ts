import path from 'path';
import fs from 'fs';
import { PATHS } from '../core/paths.js';

export interface MultimodalCapabilities {
  canGenerateImage: boolean;
  canGenerateAudio: boolean;
  imageProvider:    'gemini' | 'openai' | 'stability' | null;
  audioProvider:    'gemini' | 'openai' | 'elevenlabs' | null;
}

const IMAGE_CAPABLE_MODELS = new Set(['gemini-3.1-pro-preview', 'gemini-2.0-flash-exp']);
const AUDIO_CAPABLE_MODELS = new Set(['gemini-3.1-pro-preview']);

export function getCapabilities(modelId: string): MultimodalCapabilities {
  const hasOpenAI     = Boolean(process.env['OPENAI_API_KEY']);
  const hasElevenLabs = Boolean(process.env['ELEVENLABS_API_KEY']);
  const hasStability  = Boolean(process.env['STABILITY_API_KEY']);

  return {
    canGenerateImage: IMAGE_CAPABLE_MODELS.has(modelId) || hasOpenAI || hasStability,
    canGenerateAudio: AUDIO_CAPABLE_MODELS.has(modelId) || hasOpenAI || hasElevenLabs,
    imageProvider:    IMAGE_CAPABLE_MODELS.has(modelId) ? 'gemini'
                    : hasOpenAI ? 'openai'
                    : hasStability ? 'stability'
                    : null,
    audioProvider:    AUDIO_CAPABLE_MODELS.has(modelId) ? 'gemini'
                    : hasElevenLabs ? 'elevenlabs'
                    : hasOpenAI ? 'openai'
                    : null,
  };
}

export async function generateImage(prompt: string, modelId: string, groupId: string): Promise<{ filePath: string; mimeType: string } | null> {
  const caps = getCapabilities(modelId);
  if (!caps.canGenerateImage) return null;

  const outDir  = path.join(PATHS.workspaces, groupId, 'media');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `img-${Date.now()}.png`);

  if (caps.imageProvider === 'openai') {
    const apiKey = process.env['OPENAI_API_KEY']!;
    const r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size: '1024x1024', response_format: 'b64_json' }),
    });
    const data = await r.json() as { data?: Array<{ b64_json?: string }> };
    const b64  = data.data?.[0]?.b64_json;
    if (!b64) return null;
    fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
    return { filePath: outPath, mimeType: 'image/png' };
  }

  if (caps.imageProvider === 'stability') {
    const apiKey = process.env['STABILITY_API_KEY']!;
    const r = await fetch('https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text_prompts: [{ text: prompt, weight: 1 }], cfg_scale: 7, height: 1024, width: 1024, steps: 30, samples: 1 }),
    });
    const data = await r.json() as { artifacts?: Array<{ base64?: string }> };
    const b64  = data.artifacts?.[0]?.base64;
    if (!b64) return null;
    fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
    return { filePath: outPath, mimeType: 'image/png' };
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
