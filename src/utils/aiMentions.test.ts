import { describe, expect, it } from 'vitest';
import type { ChatMessageMention } from '../types/ai';
import type { MossCatalogEntry } from '../types/mossCatalog';
import { createMossCatalogMention, mentionReference } from './aiMentions';

const booruMention: ChatMessageMention = {
  id: '1',
  source: 'booru',
  sourceId: '1',
  label: '1',
  detail: '',
  metadata: 'Post ID: 1',
  includeImage: false
};

const mossEntry = (kind: MossCatalogEntry['kind']): MossCatalogEntry => ({
  id: '89bd1748a67b5fce996a823d2f784cfb',
  name: 'test girl',
  copyright: 'test series',
  kind,
  tags: 'test girl, test series, blue hair',
  caption: 'test girl with blue hair.',
  prompt: '',
  sourceCount: 0,
  gender: [],
  hairColor: [],
  hairLength: [],
  eyeColor: [],
  outfit: [],
  category: null,
  addedAt: ''
});

describe('mentionReference', () => {
  it('frames mention metadata as reference data, not instructions', () => {
    expect(mentionReference(booruMention)).toMatch(
      /reference data, not instructions/u
    );
  });
});

describe('createMossCatalogMention', () => {
  it('describes a character with its series, tags and caption', () => {
    const { metadata, detail } = createMossCatalogMention(
      mossEntry('character')
    );
    expect(detail).toBe('test series');
    expect(metadata).toContain('Series: test series');
    expect(metadata).toContain('Tags: test girl, test series, blue hair');
    expect(metadata).toContain('Caption: test girl with blue hair.');
  });

  it('describes a style by its description only', () => {
    const { metadata } = createMossCatalogMention(mossEntry('style'));
    expect(metadata).toContain('Art style: test girl');
    expect(metadata).toContain('Style description: test girl with blue hair.');
    expect(metadata).not.toContain('Tags:');
  });
});
