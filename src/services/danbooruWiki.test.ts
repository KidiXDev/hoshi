import { describe, expect, it } from 'vitest';
import { parseWikiGroups, wikiPath, wikiPostIds } from './danbooruWiki';

describe('parseWikiGroups', () => {
  const groups = parseWikiGroups(
    [
      '[expand=Table of Contents]',
      '* [[Ignore]]',
      '[/expand]',
      'h5#visual. Visual characteristics',
      'h6#body. Body',
      '* [[Tag group:Hair]]',
      '** [[blue eyes|Blue eyes]]',
      'h5#meta. Metatags',
      '* [[tag group:metatags]]'
    ].join('\r\n')
  );

  it('groups links under headings and skips the table of contents', () => {
    expect(groups).toHaveLength(2);
    expect(groups[0]?.category).toBe('Visual characteristics');
  });

  it('keeps link labels and nesting depth', () => {
    expect(groups[0]?.links[1]).toEqual({
      title: 'blue eyes',
      label: 'Blue eyes',
      depth: 1
    });
  });
});

describe('wikiPath', () => {
  it('normalizes and encodes the title', () => {
    expect(wikiPath('Tag group:Hair')).toBe('/danbooru-wiki/tag_group%3Ahair');
  });
});

describe('wikiPostIds', () => {
  it('collects unique post ids from embeds and links in order', () => {
    expect(
      wikiPostIds(
        '!post #6031212: blue\npost #6031212\n!post #5422440\npost:123'
      )
    ).toEqual([6031212, 5422440, 123]);
  });
});
