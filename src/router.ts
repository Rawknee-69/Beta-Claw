import { z } from 'zod';
import type { InboundMessage, IChannel, ChannelFeature } from './channels/interface.js';
import { InboundMessageSchema } from './channels/interface.js';

const GroupConfigSchema = z.object({
  triggerWord: z.string().min(1),
  allowedTools: z.array(z.string()),
  executionMode: z.string().min(1),
});

type GroupConfig = z.infer<typeof GroupConfigSchema>;

interface RoutingResult {
  groupId: string;
  shouldProcess: boolean;
  priority: number;
  reason: string;
}

const PRIORITY_DIRECT_MENTION = 10;
const PRIORITY_GROUP_MATCH = 5;
const PRIORITY_DEFAULT = 1;

const MAX_RESPONSE_LENGTH: Record<string, number> = {
  whatsapp: 4096,
  telegram: 4096,
  discord: 2000,
  cli: Infinity,
  http: Infinity,
  signal: 4096,
  slack: 4000,
};

export class MessageRouter {
  route(message: InboundMessage, groups: Map<string, GroupConfig>): RoutingResult {
    InboundMessageSchema.parse(message);

    const groupConfig = groups.get(message.groupId);

    if (!groupConfig) {
      return {
        groupId: message.groupId,
        shouldProcess: false,
        priority: 0,
        reason: 'no_group_config',
      };
    }

    GroupConfigSchema.parse(groupConfig);

    const triggered = this.shouldRespond(message, groupConfig.triggerWord);

    if (triggered) {
      const isDirect = message.content.trim().toLowerCase().startsWith(
        groupConfig.triggerWord.toLowerCase(),
      );

      return {
        groupId: message.groupId,
        shouldProcess: true,
        priority: isDirect ? PRIORITY_DIRECT_MENTION : PRIORITY_GROUP_MATCH,
        reason: isDirect ? 'direct_mention' : 'trigger_word_found',
      };
    }

    return {
      groupId: message.groupId,
      shouldProcess: false,
      priority: PRIORITY_DEFAULT,
      reason: 'no_trigger',
    };
  }

  shouldRespond(message: InboundMessage, triggerWord: string): boolean {
    const content = message.content.toLowerCase();
    const trigger = triggerWord.toLowerCase();
    return content.includes(trigger);
  }

  formatResponse(content: string, channel: IChannel): string {
    z.string().parse(content);

    let formatted = content;

    if (!channel.supportsFeature('markdown' as ChannelFeature)) {
      formatted = this.stripMarkdown(formatted);
    }

    const maxLen = MAX_RESPONSE_LENGTH[channel.id] ?? Infinity;
    if (formatted.length > maxLen) {
      formatted = formatted.slice(0, maxLen - 3) + '...';
    }

    return formatted;
  }

  private stripMarkdown(text: string): string {
    return text
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`{3}[\s\S]*?`{3}/g, (match) => {
        const inner = match.replace(/^`{3}\w*\n?/, '').replace(/\n?`{3}$/, '');
        return inner;
      })
      .replace(/`(.*?)`/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  }
}

export type { GroupConfig, RoutingResult };
export { GroupConfigSchema };
