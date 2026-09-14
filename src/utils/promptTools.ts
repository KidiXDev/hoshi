export interface PromptTag {
  id: string;
  text: string;
  weight: number;
  disabled?: boolean;
}

export interface WeightAdjustResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface FormatOptions {
  deduplicate?: boolean;
  escapeParentheses?: boolean;
  replaceUnderscores?: boolean;
  keepNewlines?: boolean;
  collapseWhitespace?: boolean;
}

export const DEFAULT_FORMAT_OPTIONS: Required<FormatOptions> = {
  deduplicate: true,
  escapeParentheses: false,
  replaceUnderscores: false,
  keepNewlines: false,
  collapseWhitespace: false
};

/**
 * Parses a single tag string into its base text and numerical weight.
 * Supports:
 * - `(masterpiece:1.2)` -> { text: 'masterpiece', weight: 1.2 }
 * - `(masterpiece)` -> { text: 'masterpiece', weight: 1.1 }
 * - `masterpiece` -> { text: 'masterpiece', weight: 1.0 }
 * - `(1girl, solo:1.15)` -> { text: '1girl, solo', weight: 1.15 }
 */
export function parseTagWeight(tagStr: string): {
  text: string;
  weight: number;
} {
  const trimmed = tagStr.trim();
  if (!trimmed) return { text: '', weight: 1.0 };

  const colonMatch = /^\((.+):([0-9.]+)\)$/u.exec(trimmed);
  if (colonMatch && colonMatch[1] && colonMatch[2]) {
    const w = Number(colonMatch[2]);
    if (!isNaN(w)) {
      return { text: colonMatch[1].trim(), weight: Math.round(w * 100) / 100 };
    }
  }

  const parenMatch = /^\((.+)\)$/u.exec(trimmed);
  if (parenMatch && parenMatch[1]) {
    return { text: parenMatch[1].trim(), weight: 1.1 };
  }

  return { text: trimmed, weight: 1.0 };
}

export function formatTagWeight(text: string, weight: number): string {
  const cleanText = text.trim();
  if (!cleanText) return '';
  const rounded = Math.round(weight * 100) / 100;
  if (rounded === 1.0) {
    return cleanText;
  }
  return `(${cleanText}:${rounded.toFixed(rounded % 1 === 0 ? 1 : 2).replace(/\.?0+$/u, (m) => (m.includes('.') ? (m === '.0' ? '.0' : '') : ''))})`;
}

export function adjustPromptWeight(
  text: string,
  selStart: number,
  selEnd: number,
  delta: number
): WeightAdjustResult {
  if (!text) {
    return { text: '', selectionStart: 0, selectionEnd: 0 };
  }

  let start = selStart;
  let end = selEnd;

  // If no range is selected, expand to surrounding tag bounds
  if (start === end) {
    // Also respect outer parentheses if cursor is inside (tag:1.2)
    let left = start;
    let openParenDepth = 0;
    while (left > 0) {
      const char = text[left - 1];
      if (char === ')') openParenDepth++;
      else if (char === '(') {
        if (openParenDepth > 0) openParenDepth--;
        else {
          left--;
          break;
        }
      } else if ((char === ',' || char === '\n') && openParenDepth === 0) {
        break;
      }
      left--;
    }

    let right = end;
    let closeParenDepth = 0;
    while (right < text.length) {
      const char = text[right];
      if (char === '(') closeParenDepth++;
      else if (char === ')') {
        if (closeParenDepth > 0) closeParenDepth--;
        else {
          right++;
          break;
        }
      } else if ((char === ',' || char === '\n') && closeParenDepth === 0) {
        break;
      }
      right++;
    }

    start = left;
    end = right;
  }

  const selected = text.slice(start, end);
  const leadingSpaces = selected.match(/^\s*/u)?.[0] || '';
  const trailingSpaces = selected.match(/\s*$/u)?.[0] || '';
  const core = selected.trim();

  if (!core) {
    return { text, selectionStart: selStart, selectionEnd: selEnd };
  }

  const parsed = parseTagWeight(core);
  let newWeight = Math.round((parsed.weight + delta) * 100) / 100;
  newWeight = Math.max(0.1, Math.min(3.0, newWeight));

  let newCore: string;
  if (newWeight === 1.0) {
    newCore = parsed.text;
  } else {
    // Format nicely: e.g. 1.05, 1.1, 1.25, 0.95
    newCore = `(${parsed.text}:${Number(newWeight.toFixed(2))})`;
  }

  const replacement = leadingSpaces + newCore + trailingSpaces;
  const newText = text.slice(0, start) + replacement + text.slice(end);
  const newSelStart = start + leadingSpaces.length;
  const newSelEnd = newSelStart + newCore.length;

  return {
    text: newText,
    selectionStart: newSelStart,
    selectionEnd: newSelEnd
  };
}

/**
 * Splits a prompt into raw tags on commas/newlines while keeping `()`, `[]`
 * and `{}` groups (and `\`-escaped characters) intact, so `{a, b|c}` stays one
 * tag. With `keepNewlines`, a standalone `'\n'` entry marks each line break.
 */
export function splitPromptTags(
  prompt: string,
  keepNewlines = false
): string[] {
  const rawTags: string[] = [];
  let tag = '';
  const groups: string[] = [];
  const closing: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const source = prompt.replaceAll(/\r\n?/gu, '\n');
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '\\' && index + 1 < source.length) {
      tag += char + source[++index];
      continue;
    }
    if (closing[char]) groups.push(closing[char]);
    else if (char === groups.at(-1)) groups.pop();
    if (
      groups.length === 0 &&
      (char === ',' || char === '，' || char === '\n')
    ) {
      rawTags.push(tag);
      if (char === '\n' && keepNewlines) rawTags.push('\n');
      tag = '';
    } else {
      tag += char === '\n' && !keepNewlines ? ' ' : char;
    }
  }
  rawTags.push(tag);
  return rawTags;
}

/**
 * Cleans and formats prompt string:
 * - Trims whitespace around tags
 * - Fixes dangling/multiple commas
 * - Optionally removes duplicate tags
 */
export function formatAndCleanPrompt(
  prompt: string,
  options?: FormatOptions
): string {
  if (!prompt.trim()) return '';
  const settings = { ...DEFAULT_FORMAT_OPTIONS, ...options };
  const rawTags = splitPromptTags(prompt, settings.keepNewlines);
  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const raw of rawTags) {
    if (raw === '\n') {
      cleaned.push('\n');
      continue;
    }
    let trimmed = raw.trim();
    if (settings.replaceUnderscores) {
      trimmed = trimmed.replaceAll(/__[^\s]+?__|_/gu, (match) =>
        match === '_' ? ' ' : match
      );
    }
    if (settings.collapseWhitespace)
      trimmed = trimmed.replaceAll(/[^\S\n]+/gu, ' ');
    if (settings.escapeParentheses)
      trimmed = trimmed.replaceAll(/\\.|[()]/gu, (match) =>
        match.length === 1 ? `\\${match}` : match
      );
    trimmed = trimmed.trim();
    if (!trimmed) continue;

    const normalizedKey = trimmed.toLowerCase();
    if (settings.deduplicate && !/^(BREAK|AND)$/u.test(trimmed)) {
      if (seen.has(normalizedKey)) continue;
      seen.add(normalizedKey);
    }

    cleaned.push(trimmed);
  }

  return cleaned
    .reduce(
      (result, value) =>
        result +
        (value === '\n' || !result || result.endsWith('\n') ? '' : ', ') +
        value,
      ''
    )
    .trim();
}

/**
 * Estimates token count and CLIP 75-token chunks.
 */
export function estimateClipTokens(prompt: string): {
  count: number;
  maxChunk: number;
  chunks: number;
  percentage: number;
} {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return { count: 0, maxChunk: 75, chunks: 1, percentage: 0 };
  }

  // Rough estimation: words + punctuation
  const words = trimmed.split(/[\s,，|\n]+/u).filter(Boolean);
  let count = 0;
  for (const word of words) {
    if (word.length > 8) {
      count += Math.ceil(word.length / 4);
    } else {
      count += 1;
    }
  }

  const chunks = Math.max(1, Math.ceil(count / 75));
  const currentChunkTokens = count % 75 || (count > 0 ? 75 : 0);
  const percentage = Math.min(100, Math.round((currentChunkTokens / 75) * 100));

  return {
    count,
    maxChunk: chunks * 75,
    chunks,
    percentage
  };
}

export function parsePromptToChips(prompt: string): PromptTag[] {
  if (!prompt.trim()) return [];

  const rawTags = splitPromptTags(prompt);
  const result: PromptTag[] = [];

  for (let i = 0; i < rawTags.length; i++) {
    const raw = rawTags[i]?.trim();
    if (!raw) continue;
    const { text, weight } = parseTagWeight(raw);
    if (text) {
      result.push({
        id: `tag-${i}-${crypto.randomUUID().slice(0, 8)}`,
        text,
        weight,
        disabled: false
      });
    }
  }

  return result;
}

export function reconstructPromptFromChips(chips: PromptTag[]): string {
  return chips
    .filter((c) => !c.disabled)
    .map((c) => formatTagWeight(c.text, c.weight))
    .filter(Boolean)
    .join(', ');
}

function normalizeTerm(term: string): string {
  return parseTagWeight(term)
    .text.toLowerCase()
    .replaceAll(/\s+/gu, ' ')
    .replaceAll('_', ' ')
    .trim();
}

/**
 * Every normalized tag in a prompt, including tags inside `{a|b}` groups so
 * a trigger word counts as present whichever option is picked.
 */
export function promptTermSet(prompt: string): Set<string> {
  const terms = new Set<string>();
  const add = (value: string) => {
    const normalized = normalizeTerm(value);
    if (normalized) terms.add(normalized);
  };
  for (const raw of splitPromptTags(prompt)) {
    const tag = raw.trim();
    if (!tag) continue;
    if (tag.startsWith('{') && tag.endsWith('}')) {
      const options = tag.slice(1, -1).split('|');
      for (const option of options) {
        for (const nested of splitPromptTags(option)) add(nested);
      }
      continue;
    }
    add(tag);
  }
  return terms;
}

/**
 * Whether `term` (which may itself be a comma-separated phrase) is already in
 * the prompt — case-insensitive, weight-stripped, `_`/space agnostic.
 */
export function promptContainsTerm(prompt: string, term: string): boolean {
  const present = promptTermSet(prompt);
  const parts = splitPromptTags(term)
    .map((part) => normalizeTerm(part))
    .filter(Boolean);
  return parts.length > 0 && parts.every((part) => present.has(part));
}

/**
 * Appends terms not already present, joining with `, ` and respecting a
 * trailing comma/newline in the existing prompt.
 */
export function appendPromptTerms(prompt: string, terms: string[]): string {
  const missing = terms
    .map((term) => term.trim())
    .filter((term) => term && !promptContainsTerm(prompt, term));
  if (missing.length === 0) return prompt;
  const current = prompt.replace(/[ \t]+$/u, '');
  if (!current.trim()) return missing.join(', ');
  const separator = /[,，]$/u.test(current)
    ? ' '
    : current.endsWith('\n')
      ? ''
      : ', ';
  return `${current}${separator}${missing.join(', ')}`;
}

/**
 * Removes every top-level tag equal to `term` (normalized comparison) while
 * leaving the rest of the prompt's formatting untouched. Tags inside `{a|b}`
 * groups are not touched.
 */
export function removePromptTerm(prompt: string, term: string): string {
  const wanted = normalizeTerm(term);
  if (!wanted) return prompt;
  const source = prompt.replaceAll(/\r\n?/gu, '\n');
  const ranges: { start: number; end: number }[] = [];
  const closing: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const groups: string[] = [];
  let tagStart = 0;
  const pushTag = (end: number) => {
    const raw = source.slice(tagStart, end);
    if (normalizeTerm(raw) === wanted) ranges.push({ start: tagStart, end });
  };
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '\\' && index + 1 < source.length) {
      index++;
      continue;
    }
    if (closing[char]) groups.push(closing[char]);
    else if (char === groups.at(-1)) groups.pop();
    if (
      groups.length === 0 &&
      (char === ',' || char === '，' || char === '\n')
    ) {
      pushTag(index);
      tagStart = index + 1;
    }
  }
  pushTag(source.length);
  if (ranges.length === 0) return prompt;

  let result = source;
  // Remove from the end so earlier offsets stay valid.
  for (let index = ranges.length - 1; index >= 0; index--) {
    const range = ranges[index];
    let { start, end } = range;
    // Drop one separator: the preceding comma (and its spacing) if present,
    // otherwise the following one. Newlines are preserved.
    const before = /[^\S\n]*[,，][^\S\n]*$/u.exec(result.slice(0, start));
    if (before) {
      start -= before[0].length;
    } else {
      const after = /^[^\S\n]*[,，][^\S\n]*/u.exec(result.slice(end));
      if (after) end += after[0].length;
    }
    result = result.slice(0, start) + result.slice(end);
  }
  return result.replaceAll(/^[^\S\n]*[,，][^\S\n]*/gmu, '').trim();
}
