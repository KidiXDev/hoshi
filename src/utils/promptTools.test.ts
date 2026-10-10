import { describe, expect, it } from 'vitest';
import {
  adjustPromptWeight,
  appendPromptTerms,
  estimateClipTokens,
  formatAndCleanPrompt,
  formatTagWeight,
  parsePromptToChips,
  parseTagWeight,
  promptContainsTerm,
  reconstructPromptFromChips,
  removePromptTerm
} from './promptTools';

describe('parseTagWeight', () => {
  it.each([
    ['masterpiece', { text: 'masterpiece', weight: 1.0 }],
    ['(masterpiece:1.2)', { text: 'masterpiece', weight: 1.2 }],
    ['(1girl, solo:1.15)', { text: '1girl, solo', weight: 1.15 }],
    ['(solo)', { text: 'solo', weight: 1.1 }]
  ])('parses %s', (tag, expected) => {
    expect(parseTagWeight(tag)).toEqual(expected);
  });
});

describe('formatTagWeight', () => {
  it('omits the default weight and wraps any other', () => {
    expect(formatTagWeight('masterpiece', 1.0)).toBe('masterpiece');
    expect(formatTagWeight('masterpiece', 1.2)).toBe('(masterpiece:1.2)');
    expect(formatTagWeight('masterpiece', 0.85)).toBe('(masterpiece:0.85)');
  });
});

describe('adjustPromptWeight', () => {
  it('steps the selected tag weight and unwraps it back at 1.0', () => {
    const first = adjustPromptWeight('1girl, masterpiece, solo', 7, 18, 0.1);
    expect(first.text).toBe('1girl, (masterpiece:1.1), solo');

    const second = adjustPromptWeight(
      first.text,
      first.selectionStart,
      first.selectionEnd,
      0.1
    );
    expect(second.text).toBe('1girl, (masterpiece:1.2), solo');

    const reset = adjustPromptWeight(
      second.text,
      second.selectionStart,
      second.selectionEnd,
      -0.2
    );
    expect(reset.text).toBe('1girl, masterpiece, solo');
  });
});

describe('formatAndCleanPrompt', () => {
  it('drops empty and duplicate tags', () => {
    expect(
      formatAndCleanPrompt(
        '1girl, , masterpiece  , 1girl, best quality,   solo, '
      )
    ).toBe('1girl, masterpiece, best quality, solo');
    expect(formatAndCleanPrompt(' , \r\n , ')).toBe('');
  });

  it('applies the formatting options', () => {
    expect(
      formatAndCleanPrompt('blue_hair, blue hair, __hair_color__', {
        replaceUnderscores: true
      })
    ).toBe('blue hair, __hair_color__');
    expect(formatAndCleanPrompt('a, a', { deduplicate: false })).toBe('a, a');
    expect(
      formatAndCleanPrompt('a,\r\n\r\n b, b', { keepNewlines: true })
    ).toBe('a\n\nb');
    expect(
      formatAndCleanPrompt('long   hair, blue\t eyes', {
        collapseWhitespace: true
      })
    ).toBe('long hair, blue eyes');
  });

  it('leaves weighted, bracketed, dynamic and BREAK groups intact', () => {
    expect(
      formatAndCleanPrompt('(a, a:1.2), [b, b], {c|c}, BREAK, BREAK')
    ).toBe('(a, a:1.2), [b, b], {c|c}, BREAK, BREAK');
  });

  it('escapes parentheses once without touching already-escaped ones', () => {
    const escaped = formatAndCleanPrompt(
      String.raw`name_(series), already\(escaped\), (weighted:1.2)`,
      { escapeParentheses: true, replaceUnderscores: true }
    );
    expect(escaped).toBe(
      String.raw`name \(series\), already\(escaped\), \(weighted:1.2\)`
    );
    expect(formatAndCleanPrompt(escaped, { escapeParentheses: true })).toBe(
      escaped
    );
  });
});

describe('estimateClipTokens', () => {
  it('fits a short prompt in a single chunk', () => {
    const tokens = estimateClipTokens('1girl, masterpiece, best quality, solo');
    expect(tokens.count).toBeGreaterThan(0);
    expect(tokens.chunks).toBe(1);
  });
});

describe('prompt chips', () => {
  it('round-trips a weighted prompt through chips', () => {
    const prompt = '1girl, (masterpiece:1.2), (solo:0.8)';
    const chips = parsePromptToChips(prompt);
    expect(chips.map(({ text, weight }) => ({ text, weight }))).toEqual([
      { text: '1girl', weight: 1 },
      { text: 'masterpiece', weight: 1.2 },
      { text: 'solo', weight: 0.8 }
    ]);
    expect(reconstructPromptFromChips(chips)).toBe(prompt);
  });
});

describe('promptContainsTerm', () => {
  it('matches regardless of weight, case, underscores and dynamic groups', () => {
    expect(promptContainsTerm('(foo:1.2), bar', 'foo')).toBe(true);
    expect(promptContainsTerm('Foo Bar, baz', 'foo_bar')).toBe(true);
    expect(promptContainsTerm('{foo|bar}, baz', 'foo')).toBe(true);
    expect(promptContainsTerm('foo, bar', 'foo, bar')).toBe(true);
  });

  it('requires whole terms', () => {
    expect(promptContainsTerm('foo', 'foo, bar')).toBe(false);
    expect(promptContainsTerm('foobar', 'foo')).toBe(false);
    expect(promptContainsTerm('', 'foo')).toBe(false);
  });
});

describe('appendPromptTerms', () => {
  it.each([
    ['', ['a'], 'a'],
    ['x,', ['a'], 'x, a'],
    ['x', ['x', 'y'], 'x, y'],
    ['x\n', ['y'], 'x\ny'],
    ['x, y', ['X', 'y'], 'x, y'],
    ['x', ['a', 'b'], 'x, a, b']
  ])('appends %j + %j → %j', (prompt, terms, expected) => {
    expect(appendPromptTerms(prompt, terms)).toBe(expected);
  });
});

describe('removePromptTerm', () => {
  it.each([
    ['a, foo, b', 'foo', 'a, b'],
    ['a, (foo:1.2)', 'foo', 'a'],
    ['foo, a', 'Foo', 'a'],
    ['a,  foo_bar ,b', 'foo bar', 'a,b'],
    ['a\nfoo\nb', 'foo', 'a\n\nb'],
    ['{foo|bar}, foo', 'foo', '{foo|bar}'],
    ['a, b', 'zzz', 'a, b']
  ])('%j without %j → %j', (prompt, term, expected) => {
    expect(removePromptTerm(prompt, term)).toBe(expected);
  });
});
