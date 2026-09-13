import { describe, expect, test } from 'bun:test';
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

describe('promptTools', () => {
  test('parses tag weights correctly', () => {
    expect(parseTagWeight('masterpiece')).toEqual({
      text: 'masterpiece',
      weight: 1.0
    });
    expect(parseTagWeight('(masterpiece:1.2)')).toEqual({
      text: 'masterpiece',
      weight: 1.2
    });
    expect(parseTagWeight('(1girl, solo:1.15)')).toEqual({
      text: '1girl, solo',
      weight: 1.15
    });
    expect(parseTagWeight('(solo)')).toEqual({
      text: 'solo',
      weight: 1.1
    });
  });

  test('formats tag weights correctly', () => {
    expect(formatTagWeight('masterpiece', 1.0)).toBe('masterpiece');
    expect(formatTagWeight('masterpiece', 1.2)).toBe('(masterpiece:1.2)');
    expect(formatTagWeight('masterpiece', 0.85)).toBe('(masterpiece:0.85)');
  });

  test('adjusts prompt weight with selected range', () => {
    const text = '1girl, masterpiece, solo';
    const selStart = 7;
    const selEnd = 18;
    const res = adjustPromptWeight(text, selStart, selEnd, 0.1);
    expect(res.text).toBe('1girl, (masterpiece:1.1), solo');

    const res2 = adjustPromptWeight(
      res.text,
      res.selectionStart,
      res.selectionEnd,
      0.1
    );
    expect(res2.text).toBe('1girl, (masterpiece:1.2), solo');

    const res3 = adjustPromptWeight(
      res2.text,
      res2.selectionStart,
      res2.selectionEnd,
      -0.2
    );
    expect(res3.text).toBe('1girl, masterpiece, solo');
  });

  test('cleans and formats prompts', () => {
    const dirty = '1girl, , masterpiece  , 1girl, best quality,   solo, ';
    expect(formatAndCleanPrompt(dirty)).toBe(
      '1girl, masterpiece, best quality, solo'
    );
  });

  test('supports formatting options without damaging grouped or escaped tags', () => {
    expect(formatAndCleanPrompt(' , \r\n , ')).toBe('');
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
    expect(
      formatAndCleanPrompt('(a, a:1.2), [b, b], {c|c}, BREAK, BREAK')
    ).toBe('(a, a:1.2), [b, b], {c|c}, BREAK, BREAK');
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

  test('estimates tokens', () => {
    const tokens = estimateClipTokens('1girl, masterpiece, best quality, solo');
    expect(tokens.count).toBeGreaterThan(0);
    expect(tokens.chunks).toBe(1);
  });

  test('chips parsing and reconstruction', () => {
    const prompt = '1girl, (masterpiece:1.2), (solo:0.8)';
    const chips = parsePromptToChips(prompt);
    expect(chips.length).toBe(3);
    expect(chips[0]?.text).toBe('1girl');
    expect(chips[1]?.weight).toBe(1.2);
    expect(chips[2]?.weight).toBe(0.8);

    const reconstructed = reconstructPromptFromChips(chips);
    expect(reconstructed).toBe('1girl, (masterpiece:1.2), (solo:0.8)');
  });
});

describe('prompt term helpers', () => {
  test('detects present terms regardless of weight, case and underscores', () => {
    expect(promptContainsTerm('(foo:1.2), bar', 'foo')).toBe(true);
    expect(promptContainsTerm('Foo Bar, baz', 'foo_bar')).toBe(true);
    expect(promptContainsTerm('{foo|bar}, baz', 'foo')).toBe(true);
    expect(promptContainsTerm('foo, bar', 'foo, bar')).toBe(true);
    expect(promptContainsTerm('foo', 'foo, bar')).toBe(false);
    expect(promptContainsTerm('foobar', 'foo')).toBe(false);
    expect(promptContainsTerm('', 'foo')).toBe(false);
  });

  test('appends only missing terms with a sensible separator', () => {
    expect(appendPromptTerms('', ['a'])).toBe('a');
    expect(appendPromptTerms('x,', ['a'])).toBe('x, a');
    expect(appendPromptTerms('x', ['x', 'y'])).toBe('x, y');
    expect(appendPromptTerms('x\n', ['y'])).toBe('x\ny');
    expect(appendPromptTerms('x, y', ['X', 'y'])).toBe('x, y');
    expect(appendPromptTerms('x', ['a', 'b'])).toBe('x, a, b');
  });
});

describe('removePromptTerm', () => {
  test('removes a tag and one separator without reformatting', () => {
    expect(removePromptTerm('a, foo, b', 'foo')).toBe('a, b');
    expect(removePromptTerm('a, (foo:1.2)', 'foo')).toBe('a');
    expect(removePromptTerm('foo, a', 'Foo')).toBe('a');
    expect(removePromptTerm('a,  foo_bar ,b', 'foo bar')).toBe('a,b');
    expect(removePromptTerm('a\nfoo\nb', 'foo')).toBe('a\n\nb');
    expect(removePromptTerm('{foo|bar}, foo', 'foo')).toBe('{foo|bar}');
    expect(removePromptTerm('a, b', 'zzz')).toBe('a, b');
  });
});
