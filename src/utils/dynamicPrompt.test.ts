import { describe, expect, it } from 'vitest';
import {
  countDynamicVariants,
  findDynamicGroups,
  hasDynamicPrompt,
  resolveDynamicPrompt,
  resolveDynamicPromptWithSeed
} from './dynamicPrompt';
import { createSeededRandom } from './seededRandom';

const always = (value: number) => () => value;

const sequence =
  (...draws: number[]) =>
  () =>
    draws.shift() ?? 0;

describe('resolveDynamicPrompt', () => {
  it('leaves static prompts untouched', () => {
    const text = '1girl, (masterpiece:1.2), \\(escaped\\)';
    expect(hasDynamicPrompt(text)).toBe(false);
    expect(resolveDynamicPrompt(text, always(0))).toBe(text);
    expect(countDynamicVariants(text)).toBe(1);
  });

  it('leaves JSON prompts untouched', () => {
    const text = '{"summary":{"caption":"a {red|blue} cup"},"items":[]}';
    expect(hasDynamicPrompt(text)).toBe(false);
    expect(findDynamicGroups(text)).toEqual([]);
    expect(resolveDynamicPrompt(text, always(0))).toBe(text);
  });

  it('picks an option from the draw', () => {
    expect(resolveDynamicPrompt('{a|b}', always(0))).toBe('a');
    expect(resolveDynamicPrompt('{a|b}', always(0.99))).toBe('b');
    expect(resolveDynamicPrompt('{a|b|c}', always(0.5))).toBe('b');
  });

  it('resolves nested groups', () => {
    expect(resolveDynamicPrompt('{a|{b|c}}', always(0.99))).toBe('c');
    expect(resolveDynamicPrompt('{a|{b|c}}', sequence(0.99, 0))).toBe('b');
  });

  it('draws once per visited group in document order', () => {
    let draws = 0;
    const alternating = () => (++draws % 2 === 1 ? 0 : 0.99);
    expect(resolveDynamicPrompt('{a|b} {c|d}', alternating)).toBe('a d');
    expect(draws).toBe(2);
  });

  it('keeps commas inside braces and tidies empty picks', () => {
    expect(resolveDynamicPrompt('{red, blue|green}, 1girl', always(0))).toBe(
      'red, blue, 1girl'
    );
    expect(resolveDynamicPrompt('1girl, {smile|}, hat', always(0.99))).toBe(
      '1girl, hat'
    );
    expect(resolveDynamicPrompt('{smile|}, hat', always(0.99))).toBe('hat');
  });

  it('handles escapes and unbalanced braces', () => {
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
});

describe('resolveDynamicPromptWithSeed', () => {
  const text = '{a|b|c|d} {e|f|g} {h|i}';

  it('is reproducible for the same seed and salt', () => {
    expect(resolveDynamicPromptWithSeed(text, 1234567890, 'positive')).toBe(
      resolveDynamicPromptWithSeed(text, 1234567890, 'positive')
    );
    expect(resolveDynamicPromptWithSeed('static', 42)).toBe('static');
  });

  it('varies across seeds', () => {
    const variants = new Set(
      Array.from({ length: 20 }, (_, seed) =>
        resolveDynamicPromptWithSeed(text, seed, 'negative')
      )
    );
    expect(variants.size).toBeGreaterThan(1);
  });
});

describe('countDynamicVariants', () => {
  it('multiplies sibling groups and sums nested options', () => {
    expect(countDynamicVariants('{a|b} {c|d|e}')).toBe(6);
    expect(countDynamicVariants('{a|{b|c}}')).toBe(3);
    expect(countDynamicVariants('{a|}')).toBe(2);
  });
});

describe('findDynamicGroups', () => {
  it('reports ranges, depth and raw options', () => {
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
  it('produces the same sequence in [0, 1) for the same seed and salt', () => {
    const first = createSeededRandom(9_999_999_999, 'x');
    const second = createSeededRandom(9_999_999_999, 'x');
    const values = Array.from({ length: 5 }, () => first());
    expect(values).toEqual(Array.from({ length: 5 }, () => second()));
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('differs across seeds and salts', () => {
    expect(createSeededRandom(0)()).not.toBe(createSeededRandom(1)());
    expect(createSeededRandom(7, 'a')()).not.toBe(createSeededRandom(7, 'b')());
  });
});
