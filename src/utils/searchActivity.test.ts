import type { ToolInvocation } from '@/types/ai';
import { describe, expect, it } from 'vitest';
import { describeSearchActivity } from './searchActivity';

function invocation(overrides: Partial<ToolInvocation>): ToolInvocation {
  return {
    id: 'call',
    name: 'search_animadex',
    args: {},
    state: 'applied',
    timestamp: 0,
    ...overrides
  };
}

describe('describeSearchActivity', () => {
  it('names the source before the query has arrived', () => {
    expect(describeSearchActivity(invocation({ state: 'building' }))).toEqual({
      label: 'Searching Animadex',
      subject: '',
      outcome: ''
    });
  });

  it('shows the category, query, and total after a catalogue search', () => {
    expect(
      describeSearchActivity(
        invocation({
          args: { query: 'miku', category: 'characters' },
          result: { total: 42, results: [{}, {}] }
        })
      )
    ).toEqual({
      label: 'Searched Animadex characters',
      subject: 'miku',
      outcome: '42 matches'
    });
  });

  it('reports a library search without matches', () => {
    expect(
      describeSearchActivity(
        invocation({
          name: 'search_character_library',
          args: { query: 'nobody' },
          result: { found: false }
        })
      )
    ).toMatchObject({ subject: 'nobody', outcome: 'No matches' });
  });

  it('distinguishes a failed search from an empty one', () => {
    expect(
      describeSearchActivity(
        invocation({
          name: 'search_character_library',
          result: { found: false, error: 'disk' }
        })
      )?.outcome
    ).toBe('Failed');
  });

  it('keeps the subject of a stopped lookup', () => {
    expect(
      describeSearchActivity(
        invocation({
          name: 'retrieve_animadex_tag_by_id',
          args: { id: 'raiden' },
          state: 'rejected'
        })
      )
    ).toMatchObject({
      label: 'Lookup stopped: Animadex character',
      subject: 'raiden'
    });
  });

  it('ignores tools that do not search', () => {
    expect(
      describeSearchActivity(invocation({ name: 'queue_generation' }))
    ).toBeNull();
  });
});
