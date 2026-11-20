import { invoke } from '@tauri-apps/api/core';

export const CHARACTER_RATINGS = [
  'general',
  'sensitive',
  'questionable',
  'explicit'
] as const;
export type CharacterRating = (typeof CHARACTER_RATINGS)[number];

export const CHARACTER_FIELD = 'character';

export const CHARACTER_DATA_NOTE =
  "Reference only, derived from Danbooru tag statistics: tags may be incomplete, may include tags that are not part of the character's canon look, or may be missing clothing and other details. Never treat an omitted tag as proof the character lacks it.";

export interface CharacterField {
  id: string;
  label: string;
  count: number;
  group: string;
}

export interface CharacterSuggestion {
  tag: string;
  count: number;
  kind: 'tag' | 'character' | 'series';
  field?: string;
  series?: string;
  alias?: string;
  hint?: string;
}

export interface CharacterPreset {
  character: string;
  series: string;
  count: number;
  fields: Record<string, string[]>;
}

export type FieldTags = Record<string, string[]>;

export interface RandomizeRequest {
  fields: string[];
  counts?: Record<string, number>;
  context: FieldTags;
  rating: CharacterRating;
  seed?: number;
  require?: string[];
}

export function getCharacterFields(): Promise<CharacterField[]> {
  return invoke('character_data_fields');
}

export function autocompleteCharacterTags(
  field: string,
  query: string,
  limit = 40
): Promise<CharacterSuggestion[]> {
  return invoke('character_data_autocomplete', { field, query, limit });
}

export function suggestCharacterTags(
  field: string,
  context: FieldTags,
  rating: CharacterRating,
  limit = 40
): Promise<CharacterSuggestion[]> {
  return invoke('character_data_suggest', { field, context, limit, rating });
}

export function getCharacterPreset(
  name: string
): Promise<CharacterPreset | null> {
  return invoke('character_data_preset', { name });
}

export function randomizeCharacterFields({
  fields,
  counts = {},
  context,
  rating,
  seed,
  require = []
}: RandomizeRequest): Promise<FieldTags> {
  return invoke('character_data_randomize', {
    fields,
    counts,
    context,
    rating,
    seed,
    require
  });
}

// Prompt formatting
const WEIGHTED_TAG = /^\((.+):(\s*-?\d*\.?\d+)\)$/u;
const KEEPS_UNDERSCORE = /^.{1,4}$|^[^a-z0-9]+_[^a-z0-9]+$/u;

export interface PromptFormat {
  spaces: boolean;
  escape: boolean;
}

export function formatCharacterTag(
  raw: string,
  { spaces, escape }: PromptFormat
): string {
  const tag = raw.trim();
  const weighted = WEIGHTED_TAG.exec(tag);
  if (weighted)
    return `(${formatCharacterTag(weighted[1], { spaces, escape })}:${weighted[2]})`;
  let out =
    spaces && !KEEPS_UNDERSCORE.test(tag) ? tag.replaceAll('_', ' ') : tag;
  if (escape) out = out.replaceAll(/(?<!\\)([()])/gu, '\\$1');
  return out;
}

export function formatCharacterTags(
  fields: FieldTags,
  format: PromptFormat
): string[] {
  const order = Object.keys(fields).sort(
    (a, b) => Number(a !== 'subject') - Number(b !== 'subject')
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of order) {
    for (const tag of fields[name]) {
      const key = tag.toLowerCase().replaceAll(' ', '_');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(formatCharacterTag(tag, format));
    }
  }
  return out;
}

export function displayTag(tag: string): string {
  return tag.replaceAll('_', ' ');
}
