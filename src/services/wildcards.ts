import type { WildcardMap } from '@/utils/dynamicPrompt';
import { invoke } from '@tauri-apps/api/core';
import type { AutocompleteItem } from './tagAutocomplete';

let loadedWildcards: Promise<WildcardMap> | null = null;

export const Wildcards = {
  load(): Promise<WildcardMap> {
    loadedWildcards ??= invoke<WildcardMap>('load_wildcards');
    return loadedWildcards;
  },

  reload(): Promise<WildcardMap> {
    loadedWildcards = null;
    return Wildcards.load();
  },

  openFolder(): Promise<void> {
    return invoke('open_wildcards_folder');
  }
};

export function searchWildcards(
  wildcards: WildcardMap,
  query: string,
  limit: number
): AutocompleteItem[] {
  const needle = query.toLowerCase();
  return Object.entries(wildcards)
    .filter(([name]) => name.includes(needle))
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, limit)
    .map(([name, options]) => ({
      label: name,
      insert_text: `__${name}__`,
      category: 'Wildcard',
      total_post: options.length,
      kind: 'wildcard'
    }));
}
