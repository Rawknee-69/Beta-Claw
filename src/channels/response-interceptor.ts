import fs from 'fs';
import { generateImage, generateAudio } from '../capabilities/multimodal.js';
import type { IChannel, OutboundMessage } from './interface.js';

export async function sendWithInterception(
  channel: IChannel,
  msg: OutboundMessage,
  modelId: string,
  groupId: string,
): Promise<void> {
  const response = msg.content;

  const imageMatch = response.match(/\[IMAGE:\s*(.+?)\]/s);
  if (imageMatch) {
    const result = await generateImage(imageMatch[1]!.trim(), modelId, groupId);
    if (result && fs.existsSync(result.filePath)) {
      await channel.send({
        groupId: msg.groupId,
        content: response.replace(/\[IMAGE:\s*.+?\]/s, '').trim() || 'Here you go!',
        attachments: [{
          type: 'image',
          data: fs.readFileSync(result.filePath),
          mimeType: result.mimeType,
          filename: 'image.png',
        }],
      });
      return;
    }
  }

  const voiceMatch = response.match(/\[VOICE:\s*(.+?)\]/s);
  if (voiceMatch) {
    const result = await generateAudio(voiceMatch[1]!.trim(), modelId, groupId);
    if (result && fs.existsSync(result.filePath)) {
      await channel.send({
        groupId: msg.groupId,
        content: response.replace(/\[VOICE:\s*.+?\]/s, '').trim(),
        attachments: [{
          type: 'audio',
          data: fs.readFileSync(result.filePath),
          mimeType: result.mimeType,
          filename: 'voice.mp3',
        }],
      });
      return;
    }
  }

  const ssMatch = response.match(/\[SCREENSHOT:(.+?)\]/);
  if (ssMatch) {
    const ssPath = ssMatch[1]!.trim();
    if (fs.existsSync(ssPath)) {
      const textWithout = response.replace(/\[SCREENSHOT:.+?\]/g, '').trim();
      await channel.send({
        groupId: msg.groupId,
        content: textWithout || 'Here is the screenshot.',
        attachments: [{
          type: 'image',
          data: fs.readFileSync(ssPath),
          mimeType: 'image/png',
          filename: 'screenshot.png',
        }],
      });
      return;
    }
  }

  await channel.send(msg);
}
