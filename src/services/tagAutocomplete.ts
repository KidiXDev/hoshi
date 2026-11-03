import { invoke } from '@tauri-apps/api/core';
import { searchWildcards, Wildcards } from './wildcards';

export interface AutocompleteItem {
  label: string;
  insert_text: string;
  category: number | string;
  total_post: number;
  kind?: 'wildcard' | 'word';
}

export type AutocompleteSearchMode = 'tag' | 'artist' | 'wildcard';
export type TagSearchAlgorithm = 'fuzzy' | 'contains' | 'prefix';

export interface TagEntry {
  tag: string;
  category: number;
  totalPost: number;
  /** Normalized search terms; the first one is the tag itself. */
  terms: string[];
}

const ARTIST_CATEGORY = 1;
const MAIN_TAG_BONUS = 10;

function normalizeTerm(text: string): string {
  return text.trim().toLowerCase().replaceAll(' ', '_');
}

function csvFields(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quoted && char === '"' && line[index + 1] === '"') {
      field += '"';
      index++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

/** Parses `tag,category,post_count,"alias1,alias2"` rows; the first row for a tag wins. */
export function parseTagCsv(text: string): TagEntry[] {
  const seen = new Set<string>();
  const entries: TagEntry[] = [];
  for (const line of text.split(/\r?\n/u)) {
    const [rawTag = '', category = '', posts = '', aliases = ''] =
      csvFields(line);
    const tag = rawTag.trim();
    if (!tag || tag === 'tag' || seen.has(tag)) continue;
    seen.add(tag);
    const aliasTerms =
      aliases.trim() === 'null'
        ? []
        : aliases
            .split(',')
            .map((alias) => normalizeTerm(alias))
            .filter(Boolean);
    entries.push({
      tag,
      category: Math.trunc(Number(category)) || 0,
      totalPost: Math.trunc(Number(posts)) || 0,
      terms: [normalizeTerm(tag), ...aliasTerms]
    });
  }
  return entries;
}

function isSubsequence(query: string, term: string): boolean {
  let matched = 0;
  for (let index = 0; index < term.length && matched < query.length; index++) {
    if (term[index] === query[matched]) matched++;
  }
  return matched === query.length;
}

function termScore(
  term: string,
  query: string,
  algorithm: TagSearchAlgorithm
): number {
  if (term === query) return 140;
  if (term.startsWith(query)) return 100;
  if (algorithm === 'prefix') return 0;
  if (term.includes(query)) return 60;
  return algorithm === 'fuzzy' && isSubsequence(query, term) ? 30 : 0;
}

function entryScore(
  entry: TagEntry,
  query: string,
  algorithm: TagSearchAlgorithm
): number {
  if (!query) return 1;
  return entry.terms.reduce((best, term, index) => {
    const score = termScore(term, query, algorithm);
    if (score <= 0) return best;
    return Math.max(best, index === 0 ? score + MAIN_TAG_BONUS : score);
  }, 0);
}

export function searchTagEntries(
  entries: readonly TagEntry[],
  query: string,
  limit: number,
  algorithm: TagSearchAlgorithm,
  category?: number
): AutocompleteItem[] {
  const normalizedQuery = normalizeTerm(query);
  const ranked: { entry: TagEntry; score: number }[] = [];
  for (const entry of entries) {
    if (category !== undefined && entry.category !== category) continue;
    const score = entryScore(entry, normalizedQuery, algorithm);
    if (score > 0) ranked.push({ entry, score });
  }
  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      b.entry.totalPost - a.entry.totalPost ||
      (a.entry.tag < b.entry.tag ? -1 : a.entry.tag > b.entry.tag ? 1 : 0)
  );
  return ranked.slice(0, limit).map(({ entry }) => ({
    label: entry.tag,
    insert_text: entry.tag,
    category: entry.category,
    total_post: entry.totalPost
  }));
}

let tagEntries: Promise<TagEntry[]> | null = null;

async function readTagEntries(): Promise<TagEntry[]> {
  const bytes = await invoke<ArrayBuffer>('load_tag_autocomplete_data');
  return parseTagCsv(new TextDecoder().decode(bytes));
}

export const TagAutocomplete = {
  load(): Promise<TagEntry[]> {
    tagEntries ??= readTagEntries();
    return tagEntries;
  },

  reload(): Promise<TagEntry[]> {
    tagEntries = null;
    return TagAutocomplete.load();
  },

  openFolder(): Promise<void> {
    return invoke('open_tag_autocomplete_folder');
  }
};

export async function searchTags(
  query: string,
  limit: number,
  mode: AutocompleteSearchMode,
  algorithm: TagSearchAlgorithm
): Promise<AutocompleteItem[]> {
  try {
    if (mode === 'wildcard') {
      return searchWildcards(await Wildcards.load(), query, limit);
    }
    return searchTagEntries(
      await TagAutocomplete.load(),
      query,
      limit,
      algorithm,
      mode === 'artist' ? ARTIST_CATEGORY : undefined
    );
  } catch {
    return [];
  }
}
