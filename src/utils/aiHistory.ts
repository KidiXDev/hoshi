import type { ChatMessage } from '@/types/ai';
import { mentionReference } from './aiMentions';

export const IMAGE_HISTORY_TURNS = 3;

type ModelPart =
  { type: 'text'; text: string } | { type: 'image'; image: string };

export type ModelMessage =
  | { role: 'user'; content: string | ModelPart[] }
  | { role: 'assistant'; content: string };

function messageImages(message: ChatMessage, canUseVision: boolean) {
  const attachments = (message.attachments ?? []).map(
    (attachment) => attachment.dataUrl
  );
  const mentions = canUseVision
    ? (message.mentions ?? []).flatMap((mention) =>
        mention.includeImage && mention.imageDataUrl
          ? [mention.imageDataUrl]
          : []
      )
    : [];
  return [...attachments, ...mentions];
}

export function toModelMessages(
  messages: ChatMessage[],
  canUseVision: boolean,
  imageTurns = IMAGE_HISTORY_TURNS
): ModelMessage[] {
  const imageTurnIds = new Set(
    messages
      .filter(
        (message) =>
          message.role === 'user' &&
          messageImages(message, canUseVision).length > 0
      )
      .slice(-imageTurns)
      .map((message) => message.id)
  );
  return messages
    .filter((message) => message.role === 'user' || message.content.trim())
    .map((message): ModelMessage => {
      if (message.role !== 'user')
        return { role: 'assistant', content: message.content };
      const text = [
        message.content,
        ...(message.mentions ?? []).map((mention) => mentionReference(mention))
      ]
        .filter(Boolean)
        .join('\n\n');
      const images = messageImages(message, canUseVision);
      if (images.length === 0) return { role: 'user', content: text };
      if (!imageTurnIds.has(message.id))
        return {
          role: 'user',
          content: [
            text,
            `[${images.length} earlier image(s) omitted to save context]`
          ]
            .filter(Boolean)
            .join('\n\n')
        };
      return {
        role: 'user',
        content: [
          ...(text ? [{ type: 'text' as const, text }] : []),
          ...images.map((image) => ({ type: 'image' as const, image }))
        ]
      };
    });
}
