import { describe, expect, test } from 'bun:test';
import {
  countDynamicVariants,
  findDynamicGroups,
  hasDynamicPrompt,
  resolveDynamicPrompt,
  resolveDynamicPromptWithSeed
} from './dynamicPrompt';
import { createSeededRandom } from './seededRandom';

const always = (value) => () => value;

describe('dynamicPrompt', () => {
  test('leaves static prompts untouched', () => {
    const text = '1girl, (masterpiece:1.2), \\(escaped\\)';
    expect(hasDynamicPrompt(text)).toBe(false);
    expect(resolveDynamicPrompt(text, always(0))).toBe(text);
    expect(countDynamicVariants(text)).toBe(1);
  });

  test('picks options by draw', () => {
    expect(resolveDynamicPrompt('{a|b}', always(0))).toBe('a');
    expect(resolveDynamicPrompt('{a|b}', always(0.99))).toBe('b');
    expect(resolveDynamicPrompt('{a|b|c}', always(0.5))).toBe('b');
  });

  test('resolves nested groups', () => {
    expect(resolveDynamicPrompt('{a|{b|c}}', always(0.99))).toBe('c');
    const draws = [0.99, 0];
    expect(resolveDynamicPrompt('{a|{b|c}}', () => draws.shift() ?? 0)).toBe(
      'b'
    );
  });

  test('one draw per visited group in document order', () => {
    const draws = [];
    const random = () => {
      draws.push(draws.length);
      return draws.length % 2 === 1 ? 0 : 0.99;
    };
    expect(resolveDynamicPrompt('{a|b} {c|d}', random)).toBe('a d');
    expect(draws.length).toBe(2);
  });

  test('keeps commas inside braces and tidies empty picks', () => {
    expect(resolveDynamicPrompt('{red, blue|green}, 1girl', always(0))).toBe(
      'red, blue, 1girl'
    );
    expect(resolveDynamicPrompt('1girl, {smile|}, hat', always(0.99))).toBe(
      '1girl, hat'
    );
    expect(resolveDynamicPrompt('{smile|}, hat', always(0.99))).toBe('hat');
  });

  test('handles escapes and unbalanced braces', () => {
    expect(resolveDynamicPrompt('\\{literal\\|x\\}', always(0))).toBe(
      '{literal|x}'
    );
    expect(hasDynamicPrompt('\\{a|b\\}')).toBe(false);
    expect(resolveDynamicPrompt('{unclosed, a|b', always(0))).toBe(
      '{unclosed, a|b'
    );
    expect(resolveDynamicPrompt('stray } here {a|b}', always(0))).toBe(
      'stray } here a'
    );
    expect(resolveDynamicPrompt('{single}', always(0))).toBe('single');
  });

  test('is reproducible for the same seed and salt', () => {
    const text = '{a|b|c|d} {e|f|g} {h|i}';
    const first = resolveDynamicPromptWithSeed(text, 1234567890, 'positive');
    const second = resolveDynamicPromptWithSeed(text, 1234567890, 'positive');
    expect(first).toBe(second);
    expect(resolveDynamicPromptWithSeed('static', 42)).toBe('static');
    const differentSalt = new Set(
      Array.from({ length: 20 }, (_, index) =>
        resolveDynamicPromptWithSeed(text, index, 'negative')
      )
    );
    expect(differentSalt.size).toBeGreaterThan(1);
  });

  test('counts variants and finds group ranges', () => {
    expect(countDynamicVariants('{a|b} {c|d|e}')).toBe(6);
    expect(countDynamicVariants('{a|{b|c}}')).toBe(3);
    expect(countDynamicVariants('{a|}')).toBe(2);
    const groups = findDynamicGroups('x {a|b} y {c|{d|e}}');
    expect(
      groups.map((group) => [group.start, group.end, group.depth])
    ).toEqual([
      [2, 7, 0],
      [10, 19, 0],
      [13, 18, 1]
    ]);
    expect(groups[1]?.options).toEqual(['c', '{d|e}']);
  });
});

describe('createSeededRandom', () => {
  test('produces deterministic sequences in [0, 1)', () => {
    const a = createSeededRandom(9_999_999_999, 'x');
    const b = createSeededRandom(9_999_999_999, 'x');
    const sequence = Array.from({ length: 5 }, () => a());
    expect(sequence).toEqual(Array.from({ length: 5 }, () => b()));
    for (const value of sequence) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    expect(createSeededRandom(0)()).not.toBe(createSeededRandom(1)());
    expect(createSeededRandom(7, 'a')()).not.toBe(createSeededRandom(7, 'b')());
  });
});
