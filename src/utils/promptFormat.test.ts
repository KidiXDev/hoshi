import { describe, expect, it } from 'vitest';
import { formatPrompt, removeNegativeOverlap } from './promptFormat';

describe('formatPrompt', () => {
  it('trims parts and drops empty ones', () => {
    expect(formatPrompt(' 1girl ,, solo,  blue hair , ')).toBe(
      '1girl, solo, blue hair'
    );
  });

  it('keeps newlines inside a part', () => {
    expect(formatPrompt('a\nb, c')).toBe('a\nb, c');
  });
});

describe('removeNegativeOverlap', () => {
  it('drops negative parts that also appear in the positive prompt', () => {
    expect(
      removeNegativeOverlap('1girl, Blue  Hair', 'blue hair, lowres, 1girl')
    ).toBe('lowres');
  });

  it('keeps the negative prompt when nothing overlaps', () => {
    expect(removeNegativeOverlap('1girl', 'lowres, bad hands')).toBe(
      'lowres, bad hands'
    );
  });
});
