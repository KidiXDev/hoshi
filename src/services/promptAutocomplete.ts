export interface PromptTokenRange {
  start: number;
  end: number;
  query: string;
  mode: 'tag' | 'artist' | 'wildcard';
}

const TOKEN_BOUNDARIES = new Set([',', '\n', '{', '|', '}']);
const EMPHASIS_BRACKETS = new Set(['(', ')', '[', ']']);

export function getPromptTokenRange(
  text: string,
  cursor: number
): PromptTokenRange | null {
  // `{`, `|` and `}` bound tokens so completion works inside `{a|b}` groups;
  // unescaped emphasis brackets and a trailing `:weight` stay outside the token.
  const isBoundary = (index: number) =>
    TOKEN_BOUNDARIES.has(text[index]) ||
    (EMPHASIS_BRACKETS.has(text[index]) && text[index - 1] !== '\\');
  let start = cursor;
  while (start > 0 && !isBoundary(start - 1)) start--;
  let end = cursor;
  while (end < text.length && !isBoundary(end) && text[end] !== ':') end++;
  const token = text.slice(start, cursor).trim();
  const mode = token.startsWith('@')
    ? 'artist'
    : token.startsWith('$')
      ? 'wildcard'
      : 'tag';
  const query = (mode === 'tag' ? token : token.slice(1))
    .toLowerCase()
    .replaceAll(' ', '_');
  return query || mode !== 'tag' ? { start, end, query, mode } : null;
}

export interface PromptWordRange {
  start: number;
  end: number;
  query: string;
}

export function getPromptWordRange(
  text: string,
  cursor: number
): PromptWordRange | null {
  const query = /\p{L}[\p{L}']*$/u.exec(text.slice(0, cursor))?.[0] ?? '';
  if (query.length < 2) return null;
  const tail = /^[\p{L}']*/u.exec(text.slice(cursor))?.[0] ?? '';
  return { start: cursor - query.length, end: cursor + tail.length, query };
}

export function replacePromptWord(
  text: string,
  range: PromptWordRange,
  word: string
): { text: string; cursor: number } {
  return {
    text: text.slice(0, range.start) + word + text.slice(range.end),
    cursor: range.start + word.length
  };
}

export interface PromptInsertOptions {
  autocompleteReplaceUnderscores?: boolean;
  autocompleteIncludeArtistPrefix?: boolean;
  autocompleteEscapeParentheses?: boolean;
}

export function replacePromptToken(
  text: string,
  range: PromptTokenRange,
  tag: string,
  {
    autocompleteReplaceUnderscores = false,
    autocompleteIncludeArtistPrefix = true,
    autocompleteEscapeParentheses = true
  }: PromptInsertOptions = {}
): { text: string; cursor: number } {
  const prefix = text.slice(0, range.start);
  const separator =
    prefix.endsWith(',') || (prefix && !/[\s{|([]$/u.test(prefix)) ? ' ' : '';
  let value = tag;
  if (range.mode !== 'wildcard') {
    if (autocompleteReplaceUnderscores) value = value.replaceAll('_', ' ');
    if (autocompleteEscapeParentheses)
      value = value.replaceAll(/(?<!\\)[()]/gu, '\\$&');
  }
  const marker =
    range.mode === 'artist' && autocompleteIncludeArtistPrefix ? '@' : '';
  // No trailing comma inside a `{a|b}` group or an emphasis bracket.
  const insideGroup =
    /(^|[^\\])[([]$/u.test(prefix) ||
    /^\s*[|}\]):]/u.test(text.slice(range.end));
  const trailing = insideGroup ? '' : ', ';
  const inserted = `${separator}${marker}${value}${trailing}`;
  return {
    text: prefix + inserted + text.slice(range.end).replace(/^\s*,?\s*/u, ''),
    cursor: prefix.length + inserted.length
  };
}
