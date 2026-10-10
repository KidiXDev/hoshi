import type { ChatMessage } from '@/types/ai';
import { describe, expect, it } from 'vitest';
import { toModelMessages } from './aiHistory';

const userTurn = (id: string, images: number): ChatMessage => ({
  id,
  role: 'user',
  content: `turn ${id}`,
  createdAt: 0,
  attachments: Array.from({ length: images }, (_, index) => ({
    id: `${id}-${index}`,
    name: 'image.jpg',
    type: 'image/jpeg',
    dataUrl: `data:image/jpeg;base64,${id}${index}`
  }))
});

const assistantTurn = (id: string, content: string): ChatMessage => ({
  id,
  role: 'assistant',
  content,
  createdAt: 0
});

describe('toModelMessages', () => {
  const messages = [
    userTurn('1', 1),
    assistantTurn('a', 'ok'),
    assistantTurn('b', '  '),
    userTurn('2', 2),
    userTurn('3', 0),
    userTurn('4', 1)
  ];
  const result = toModelMessages(messages, true, 2);

  it('drops blank assistant turns', () => {
    expect(result).toHaveLength(5);
    expect(result[1]).toEqual({ role: 'assistant', content: 'ok' });
  });

  it('replaces images outside the recent image turns with a note', () => {
    expect(result[0]).toEqual({
      role: 'user',
      content: 'turn 1\n\n[1 earlier image(s) omitted to save context]'
    });
  });

  it('keeps images on the most recent image turns', () => {
    expect(result[2]?.content).toHaveLength(3);
    expect(result[3]).toEqual({ role: 'user', content: 'turn 3' });
    expect(result[4]?.content).toEqual([
      { type: 'text', text: 'turn 4' },
      { type: 'image', image: 'data:image/jpeg;base64,40' }
    ]);
  });
});
