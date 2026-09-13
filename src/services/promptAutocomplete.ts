export interface PromptTokenRange {
  start: number;
  end: number;
  query: string;
  mode: 'tag' | 'artist' | 'wildcard';
}

export function getPromptTokenRange(
  text: string,
  cursor: number
): PromptTokenRange | null {
  // `{`, `|` and `}` bound tokens too so completion works inside `{a|b}` groups.
  const boundaries = [',', '\n', '{', '|', '}'];
  let start = cursor;
  while (start > 0 && !boundaries.includes(text[start - 1])) start--;
  let end = cursor;
  while (end < text.length && !boundaries.includes(text[end])) end++;
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

export function replacePromptToken(
  text: string,
  range: PromptTokenRange,
  tag: string,
  replaceUnderscores = false,
  includeArtistPrefix = true
): { text: string; cursor: number } {
  const prefix = text.slice(0, range.start);
  const separator =
    prefix.endsWith(',') || (prefix && !/[\s{|]$/u.test(prefix)) ? ' ' : '';
  const value =
    range.mode !== 'wildcard' && replaceUnderscores
      ? tag.replaceAll('_', ' ')
      : tag;
  const marker = range.mode === 'artist' && includeArtistPrefix ? '@' : '';
  // Inside a `{a|b}` group the option delimiter follows, so no trailing comma.
  const trailing = /^\s*[|}]/u.test(text.slice(range.end)) ? '' : ', ';
  const inserted = `${separator}${marker}${value}${trailing}`;
  return {
    text: prefix + inserted + text.slice(range.end).replace(/^\s*,?\s*/u, ''),
    cursor: prefix.length + inserted.length
  };
}
