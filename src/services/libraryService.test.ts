import { describe, expect, it } from 'vitest';
import { isBooruMediaUrl } from './libraryService';

describe('isBooruMediaUrl', () => {
  it.each([
    ['http://booru-image.localhost/?url=x', true],
    ['booru-image://localhost/?url=x', true],
    ['https://cdn.example.com/image.png', false]
  ])('%s → %s', (url, expected) => {
    expect(isBooruMediaUrl(url)).toBe(expected);
  });
});
