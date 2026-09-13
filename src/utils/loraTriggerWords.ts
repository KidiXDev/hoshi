import { promptContainsTerm } from './promptTools';

export type TriggerWordSource = 'civitai' | 'suggested';

export interface TriggerWord {
  word: string;
  source: TriggerWordSource;
}

/**
 * Civitai trained words first, then header-derived suggestions that are not
 * already covered (case/underscore-insensitive). Preserves order, dedupes.
 */
const normalize = (word: string) =>
  word.toLowerCase().replaceAll('_', ' ').replaceAll(/\s+/gu, ' ').trim();

export function mergeTriggerWords(
  trained: string[],
  suggested: string[]
): TriggerWord[] {
  const seen = new Set<string>();
  const result: TriggerWord[] = [];
  const push = (word: string, source: TriggerWordSource) => {
    const key = normalize(word);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push({ word: word.trim(), source });
  };
  for (const word of trained) push(word, 'civitai');
  if (result.length === 0) {
    for (const word of suggested) push(word, 'suggested');
  }
  return result;
}

export type TriggerWordState = 'present' | 'missing';

export function wordState(prompt: string, word: string): TriggerWordState {
  return promptContainsTerm(prompt, word) ? 'present' : 'missing';
}

/** Words from `words` that are not yet in `prompt`, in order. */
export function missingTriggerWords(prompt: string, words: string[]): string[] {
  return words.filter((word) => wordState(prompt, word) === 'missing');
}
