import { describe, expect, it } from 'vitest';
import {
  getPromptTokenRange,
  getPromptWordRange,
  replacePromptToken,
  replacePromptWord,
  type PromptTokenRange
} from './promptAutocomplete';

function tokenAt(text: string, cursor: number): PromptTokenRange {
  const range = getPromptTokenRange(text, cursor);
  if (!range) throw new Error(`No prompt token at ${cursor} in "${text}"`);
  return range;
}

describe('getPromptTokenRange', () => {
  it('normalizes spaces to underscores in a tag query', () => {
    expect(tokenAt('masterpiece, blu ha, cinematic', 19)).toMatchObject({
      query: 'blu_ha',
      mode: 'tag'
    });
  });

  it('detects wildcard tokens', () => {
    expect(tokenAt('$pose', 5).mode).toBe('wildcard');
  });

  it('bounds tokens inside dynamic prompt groups', () => {
    expect(tokenAt('1girl, {red ha|blue hair} eyes', 14).query).toBe('red_ha');
  });

  it('excludes emphasis brackets and the weight suffix', () => {
    expect(tokenAt('masterpiece, (blu', 17).query).toBe('blu');
    expect(tokenAt('(blue_ha:1.2), solo', 8).query).toBe('blue_ha');
  });

  it('treats escaped parentheses and colons as tag text', () => {
    expect(tokenAt('1girl, hatsune_miku_\\(voc', 25)).toMatchObject({
      start: 6,
      query: 'hatsune_miku_\\(voc'
    });
    expect(tokenAt('1girl, re:ze', 12).query).toBe('re:ze');
  });
});

describe('replacePromptToken', () => {
  describe('tags', () => {
    const text = 'masterpiece, blu ha, cinematic';
    const range = tokenAt(text, 19);

    it('replaces the token in place and moves the cursor after it', () => {
      expect(replacePromptToken(text, range, 'blue_hair')).toEqual({
        text: 'masterpiece, blue_hair, cinematic',
        cursor: 24
      });
    });

    it('replaces underscores when enabled', () => {
      expect(
        replacePromptToken(text, range, 'blue_hair', {
          autocompleteReplaceUnderscores: true
        })
      ).toEqual({ text: 'masterpiece, blue hair, cinematic', cursor: 24 });
    });
  });

  describe('artists', () => {
    const text = 'masterpiece, @sak';
    const range = tokenAt(text, 17);

    it('keeps the @ prefix and appends a separator', () => {
      expect(replacePromptToken(text, range, 'sakura')).toEqual({
        text: 'masterpiece, @sakura, ',
        cursor: 22
      });
    });

    it('drops the prefix when disabled', () => {
      expect(
        replacePromptToken(text, range, 'sakura', {
          autocompleteIncludeArtistPrefix: false
        })
      ).toEqual({ text: 'masterpiece, sakura, ', cursor: 21 });
    });
  });

  it('never replaces underscores in wildcard names', () => {
    expect(
      replacePromptToken('$pose', tokenAt('$pose', 5), '__pose__', {
        autocompleteReplaceUnderscores: true
      })
    ).toEqual({ text: '__pose__, ', cursor: 10 });
  });

  it('replaces only the option being edited in a dynamic group', () => {
    const text = '1girl, {red ha|blue hair} eyes';
    expect(replacePromptToken(text, tokenAt(text, 14), 'red_hair')).toEqual({
      text: '1girl, {red_hair|blue hair} eyes',
      cursor: 16
    });
  });

  it.each([
    ['masterpiece, (blu', 17, 'masterpiece, (blue_hair', 23],
    ['(blu), solo', 4, '(blue_hair), solo', 10],
    ['(blue_ha:1.2), solo', 8, '(blue_hair:1.2), solo', 10],
    ['[blu]', 4, '[blue_hair]', 10]
  ])('keeps emphasis around %j', (text, cursor, expected, expectedCursor) => {
    expect(
      replacePromptToken(text, tokenAt(text, cursor), 'blue_hair')
    ).toEqual({ text: expected, cursor: expectedCursor });
  });

  describe('parentheses in tag names', () => {
    const text = '1girl, hatsune';
    const range = tokenAt(text, 14);
    const escaped = {
      text: '1girl, hatsune_miku_\\(vocaloid\\), ',
      cursor: 34
    };

    it('escapes them for ComfyUI', () => {
      expect(
        replacePromptToken(text, range, 'hatsune_miku_(vocaloid)')
      ).toEqual(escaped);
    });

    it('does not double-escape', () => {
      expect(
        replacePromptToken(text, range, 'hatsune_miku_\\(vocaloid\\)')
      ).toEqual(escaped);
    });

    it('leaves them as-is when escaping is disabled', () => {
      expect(
        replacePromptToken(text, range, 'hatsune_miku_(vocaloid)', {
          autocompleteEscapeParentheses: false
        })
      ).toEqual({ text: '1girl, hatsune_miku_(vocaloid), ', cursor: 32 });
    });
  });
});

describe('getPromptWordRange', () => {
  it('takes only the last word of a sentence', () => {
    const text = 'A girl on the bea';
    expect(getPromptWordRange(text, text.length)).toEqual({
      start: 14,
      end: 17,
      query: 'bea'
    });
  });

  it('spans the rest of the word when the cursor is inside it', () => {
    expect(getPromptWordRange('the beach.', 6)).toEqual({
      start: 4,
      end: 9,
      query: 'be'
    });
  });

  it('keeps apostrophes inside a word', () => {
    expect(getPromptWordRange("she isn'", 8)?.query).toBe("isn'");
  });

  it('ignores a single letter', () => {
    expect(getPromptWordRange('a b', 3)).toBeNull();
  });

  it('ignores a cursor after punctuation', () => {
    expect(getPromptWordRange('the beach,', 10)).toBeNull();
  });
});

describe('replacePromptWord', () => {
  it('replaces the whole word and moves the cursor after it', () => {
    expect(
      replacePromptWord(
        'on the bea, at dusk',
        { start: 7, end: 10, query: 'bea' },
        'beach'
      )
    ).toEqual({ text: 'on the beach, at dusk', cursor: 12 });
  });
});
