import { invoke } from '@tauri-apps/api/core';
import type { AutocompleteItem } from './comfyApi';

const WORD_PATTERN = /^[a-z]+(?:'[a-z]+)*$/u;

let wordList: Promise<string[]> | null = null;

async function readWordList(): Promise<string[]> {
  const [bytes, { decodeAsync }] = await Promise.all([
    invoke<ArrayBuffer>('load_word_frequency_data'),
    import('@msgpack/msgpack')
  ]);
  const data = await decodeAsync(
    new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  );
  const [header, ...buckets] = Array.isArray(data) ? data : [];
  const { format, version } = (header ?? {}) as Record<string, unknown>;
  if (format !== 'cB' || version !== 1) {
    throw new Error('Not a wordfreq cBpack word list');
  }
  return buckets
    .flat()
    .filter(
      (word): word is string =>
        typeof word === 'string' && WORD_PATTERN.test(word)
    );
}

export const WordAutocomplete = {
  load(): Promise<string[]> {
    wordList ??= readWordList();
    return wordList;
  },

  reload(): Promise<string[]> {
    wordList = null;
    return WordAutocomplete.load();
  },

  openFolder(): Promise<void> {
    return invoke('open_word_frequency_folder');
  }
};

export function suggestWords(
  words: readonly string[],
  query: string,
  limit: number
): AutocompleteItem[] {
  const prefix = query.toLowerCase();
  const capitalize = /^\p{Lu}/u.test(query);
  const items: AutocompleteItem[] = [];
  for (const word of words) {
    if (items.length >= limit) break;
    if (!word.startsWith(prefix)) continue;
    const text = capitalize ? word[0].toUpperCase() + word.slice(1) : word;
    items.push({
      label: text,
      insert_text: text,
      category: 'word',
      total_post: 0,
      kind: 'word'
    });
  }
  return items;
}
