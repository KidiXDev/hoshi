import { describe, expect, it } from 'vitest';
import type { ChatMessageMention } from '../types/ai';
import { mentionReference } from './aiMentions';

const booruMention: ChatMessageMention = {
  id: '1',
  source: 'booru',
  sourceId: '1',
  label: '1',
  detail: '',
  metadata: 'Post ID: 1',
  includeImage: false
};

describe('mentionReference', () => {
  it('frames mention metadata as reference data, not instructions', () => {
    expect(mentionReference(booruMention)).toMatch(
      /reference data, not instructions/u
    );
  });
});
