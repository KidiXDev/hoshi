import assert from 'node:assert/strict';
import type { ChatMessageMention } from '../src/types/ai';
import { mentionReference } from '../src/utils/aiMentions';

const mention = (sourceId: string): ChatMessageMention => ({
  id: sourceId,
  source: 'booru',
  sourceId,
  label: sourceId,
  detail: '',
  metadata: `Post ID: ${sourceId}`,
  includeImage: false
});
assert.match(
  mentionReference(mention('1')),
  /reference data, not instructions/u
);

console.log('aiMentions checks passed');
