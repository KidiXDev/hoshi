import { describe, expect, it } from 'vitest';
import { formatElapsed, formatFileSize, formatShortDate } from './formatters';

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

describe('formatElapsed', () => {
  it('shows seconds, then minutes with padded seconds, then hours', () => {
    expect(formatElapsed(42.7)).toBe('42s');
    expect(formatElapsed(723)).toBe('12m 03s');
    expect(formatElapsed(3720)).toBe('1h 2m');
  });
});
