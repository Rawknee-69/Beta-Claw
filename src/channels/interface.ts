import { z } from 'zod';

const AttachmentSchema = z.object({
  type: z.enum(['image', 'audio', 'video', 'document', 'file']),
  url: z.string().optional(),
  data: z.instanceof(Buffer).optional(),
  mimeType: z.string(),
  filename: z.string().optional(),
});

const InboundMessageSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  senderId: z.string(),
  content: z.string(),
  timestamp: z.number().int(),
  replyToId: z.string().optional(),
  attachments: z.array(AttachmentSchema).optional(),
});

const OutboundMessageSchema = z.object({
  groupId: z.string(),
  content: z.string(),
  replyToId: z.string().optional(),
  attachments: z.array(AttachmentSchema).optional(),
});

type Attachment = z.infer<typeof AttachmentSchema>;
type InboundMessage = z.infer<typeof InboundMessageSchema>;
type OutboundMessage = z.infer<typeof OutboundMessageSchema>;

type ChannelFeature = 'markdown' | 'images' | 'files' | 'reactions' | 'threads' | 'webhooks';

interface IChannel {
  id: string;
  name: string;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(msg: OutboundMessage): Promise<void>;
  onMessage(handler: (msg: InboundMessage) => void | Promise<void>): void;
  supportsFeature(f: ChannelFeature): boolean;
}

export type {
  IChannel,
  InboundMessage,
  OutboundMessage,
  Attachment,
  ChannelFeature,
};
export { InboundMessageSchema, OutboundMessageSchema, AttachmentSchema };
