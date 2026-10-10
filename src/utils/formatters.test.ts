import { describe, expect, it } from 'vitest';
import { formatFileSize, formatShortDate } from './formatters';

describe('formatFileSize', () => {
  it('formats byte sizes with one decimal above bytes', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(1536)).toBe('1.5 KB');
  });
});

describe('formatShortDate', () => {
  it('keeps an empty timestamp empty', () => {
    expect(formatShortDate(0)).toBe('');
  });
});
