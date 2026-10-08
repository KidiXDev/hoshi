import { expect, test } from 'bun:test';
import { toModelMessages } from './aiHistory';

const user = (id, images) => ({
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

test('only the most recent image turns keep their images', () => {
  const messages = [
    user('1', 1),
    { id: 'a', role: 'assistant', content: 'ok', createdAt: 0 },
    { id: 'b', role: 'assistant', content: '  ', createdAt: 0 },
    user('2', 2),
    user('3', 0),
    user('4', 1)
  ];
  const result = toModelMessages(messages, true, 2);
  expect(result).toHaveLength(5);
  expect(result[0]).toEqual({
    role: 'user',
    content: 'turn 1\n\n[1 earlier image(s) omitted to save context]'
  });
  expect(result[1]).toEqual({ role: 'assistant', content: 'ok' });
  expect(result[2].content).toHaveLength(3);
  expect(result[3]).toEqual({ role: 'user', content: 'turn 3' });
  expect(result[4].content).toEqual([
    { type: 'text', text: 'turn 4' },
    { type: 'image', image: 'data:image/jpeg;base64,40' }
  ]);
});
