import { describe, expect, it } from 'vitest';
import {
  buildBooruPrompt,
  formatBooruWarnings,
  getKonachanAccessIssue,
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

describe('getKonachanAccessIssue', () => {
  it('recognizes when clearance still results in HTTP 403', () => {
    const error =
      'The verification window received clearance, but the gallery still could not load Konachan (R18). konachan.com request was blocked by Cloudflare verification (HTTP 403 Forbidden).';
    expect(getKonachanAccessIssue('konachan.com', error)).toBe(
      'rejected-after-verification'
    );
    expect(getKonachanAccessIssue('konachan.net', error)).toBeNull();
  });

  it('distinguishes a solvable challenge from a firewall denial', () => {
    expect(
      getKonachanAccessIssue(
        'konachan.com',
        'konachan.com request was blocked by Cloudflare verification (HTTP 403 Forbidden).'
      )
    ).toBe('challenge');
    expect(
      getKonachanAccessIssue(
        'konachan.com',
        "konachan.com request was blocked by the site's Cloudflare firewall (HTTP 403 Forbidden)."
      )
    ).toBe('firewall');
    expect(
      getKonachanAccessIssue('konachan.com', 'Connection timed out')
    ).toBeNull();
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
