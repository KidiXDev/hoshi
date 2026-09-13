import { describe, expect, test } from 'bun:test';
import {
  mergeTriggerWords,
  missingTriggerWords,
  wordState
} from './loraTriggerWords';

describe('loraTriggerWords', () => {
  test('prefers civitai words and only falls back to suggestions', () => {
    expect(mergeTriggerWords(['Foo_Bar', 'foo bar', 'baz'], ['zzz'])).toEqual([
      { word: 'Foo_Bar', source: 'civitai' },
      { word: 'baz', source: 'civitai' }
    ]);
    expect(mergeTriggerWords([], ['1girl', '1girl', 'solo'])).toEqual([
      { word: '1girl', source: 'suggested' },
      { word: 'solo', source: 'suggested' }
    ]);
    expect(mergeTriggerWords([' ', ''], [])).toEqual([]);
  });

  test('reports presence against the prompt', () => {
    expect(wordState('1girl, (foo bar:1.2)', 'foo_bar')).toBe('present');
    expect(wordState('1girl', 'foo_bar')).toBe('missing');
    expect(missingTriggerWords('a, b', ['a', 'c', 'b', 'd'])).toEqual([
      'c',
      'd'
    ]);
  });
});
