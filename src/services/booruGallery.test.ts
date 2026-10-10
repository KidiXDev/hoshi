import { describe, expect, it } from 'vitest';
import {
  buildBooruPrompt,
  formatBooruWarnings,
  normalizeBooruRatings
} from './booruGallery';

describe('normalizeBooruRatings', () => {
  it('returns the available ratings when the source has fewer than two', () => {
    expect(normalizeBooruRatings([], ['general'])).toEqual([]);
    expect(normalizeBooruRatings(['safe'], [])).toEqual(['safe']);
  });

  it('keeps saved ratings the source supports', () => {
    expect(
      normalizeBooruRatings(['general', 'explicit'], ['explicit', 'unknown'])
    ).toEqual(['explicit']);
  });

  it('falls back to general when no saved rating is supported', () => {
    expect(normalizeBooruRatings(['general', 'explicit'], ['unknown'])).toEqual(
      ['general']
    );
  });
});

describe('buildBooruPrompt', () => {
  it('orders categories, formats tags and skips duplicates and excluded tags', () => {
    expect(
      buildBooruPrompt(
        {
          copyright: ['series_name'],
          character: ['alice_(wonderland)'],
          general: ['blue_hair', 'series_name']
        },
        {
          categories: ['copyright', 'character', 'general'],
          replaceUnderscores: true,
          escapeParentheses: true
        },
        ['blue_hair']
      )
    ).toBe('series name, alice \\(wonderland\\)');
  });
});

describe('formatBooruWarnings', () => {
  it('shows only user-facing warnings', () => {
    expect(
      formatBooruWarnings([
        'local-blacklist-filtered',
        'restricted-media-hidden'
      ])
    ).toEqual(['Some restricted posts are unavailable for this account.']);
  });
});
