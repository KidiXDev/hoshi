import { describe, expect, it } from 'vitest';
import {
  mergeTriggerWords,
  missingTriggerWords,
  wordState
} from './loraTriggerWords';

describe('mergeTriggerWords', () => {
  it('prefers Civitai words and dedupes them by normalized form', () => {
    expect(mergeTriggerWords(['Foo_Bar', 'foo bar', 'baz'], ['zzz'])).toEqual([
      { word: 'Foo_Bar', source: 'civitai' },
      { word: 'baz', source: 'civitai' }
    ]);
  });

  it('falls back to deduped suggestions when Civitai has none', () => {
    expect(mergeTriggerWords([], ['1girl', '1girl', 'solo'])).toEqual([
      { word: '1girl', source: 'suggested' },
      { word: 'solo', source: 'suggested' }
    ]);
  });

  it('drops blank words', () => {
    expect(mergeTriggerWords([' ', ''], [])).toEqual([]);
  });
});

describe('wordState', () => {
  it('detects weighted and space-separated forms in the prompt', () => {
    expect(wordState('1girl, (foo bar:1.2)', 'foo_bar')).toBe('present');
    expect(wordState('1girl', 'foo_bar')).toBe('missing');
  });
});

describe('missingTriggerWords', () => {
  it('keeps the order of words absent from the prompt', () => {
    expect(missingTriggerWords('a, b', ['a', 'c', 'b', 'd'])).toEqual([
      'c',
      'd'
    ]);
  });
});
