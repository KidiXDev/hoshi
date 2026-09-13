import { createSeededRandom } from './seededRandom';

/**
 * Dynamic prompt syntax: `{option_a|option_b|option_c}` picks one option per
 * generation. Groups nest (`{a|{b|c}}`), commas inside braces are content,
 * empty options are allowed (`{a|}`), and `\{`, `\}`, `\|` produce literal
 * characters. Unbalanced braces are left as-is.
 */

export interface DynamicGroup {
  /** Index of the opening `{`. */
  start: number;
  /** Index just past the closing `}`. */
  end: number;
  options: string[];
  depth: number;
}

type TextNode = { type: 'text'; value: string };
type GroupNode = {
  type: 'group';
  start: number;
  end: number;
  options: PromptNode[][];
};
type PromptNode = TextNode | GroupNode;

const ESCAPABLE = new Set(['{', '}', '|']);
const MAX_VARIANTS = 1_000_000;

interface ParseResult {
  nodes: PromptNode[];
  /** Index where parsing stopped (at `}` / `|` when inside a group). */
  index: number;
  stoppedAt: '}' | '|' | 'end';
}

function pushText(nodes: PromptNode[], value: string) {
  if (!value) return;
  const last = nodes.at(-1);
  if (last?.type === 'text') last.value += value;
  else nodes.push({ type: 'text', value });
}

function parseSequence(
  text: string,
  from: number,
  insideGroup: boolean
): ParseResult {
  const nodes: PromptNode[] = [];
  let buffer = '';
  let index = from;
  while (index < text.length) {
    const char = text[index];
    if (char === '\\' && index + 1 < text.length) {
      const next = text[index + 1];
      // Only our own delimiters are unescaped; `\(` etc. stay verbatim for ComfyUI.
      buffer += ESCAPABLE.has(next) ? next : char + next;
      index += 2;
      continue;
    }
    if (char === '{') {
      const group = parseGroup(text, index);
      if (group) {
        pushText(nodes, buffer);
        buffer = '';
        nodes.push(group);
        index = group.end;
        continue;
      }
      buffer += char;
      index++;
      continue;
    }
    if (insideGroup && (char === '}' || char === '|')) {
      pushText(nodes, buffer);
      return { nodes, index, stoppedAt: char };
    }
    buffer += char;
    index++;
  }
  pushText(nodes, buffer);
  return { nodes, index, stoppedAt: 'end' };
}

/** Parses a group starting at `{`; returns null when it is never closed. */
function parseGroup(text: string, start: number): GroupNode | null {
  const options: PromptNode[][] = [];
  let index = start + 1;
  for (;;) {
    const option = parseSequence(text, index, true);
    options.push(option.nodes);
    if (option.stoppedAt === '}') {
      return { type: 'group', start, end: option.index + 1, options };
    }
    if (option.stoppedAt === 'end') return null;
    index = option.index + 1;
  }
}

export function parseDynamicPrompt(text: string): PromptNode[] {
  return parseSequence(text, 0, false).nodes;
}

function collectGroups(
  nodes: PromptNode[],
  depth: number,
  text: string,
  out: DynamicGroup[]
) {
  for (const node of nodes) {
    if (node.type !== 'group') continue;
    out.push({
      start: node.start,
      end: node.end,
      options: node.options.map((option) => renderNodes(option)),
      depth
    });
    for (const option of node.options)
      collectGroups(option, depth + 1, text, out);
  }
}

/** Renders nodes back to text without resolving (groups keep their braces). */
function renderNodes(nodes: PromptNode[]): string {
  return nodes
    .map((node) =>
      node.type === 'text'
        ? node.value
        : `{${node.options.map(renderNodes).join('|')}}`
    )
    .join('');
}

/** All groups in document order; `depth` 0 = outermost. */
export function findDynamicGroups(text: string): DynamicGroup[] {
  const groups: DynamicGroup[] = [];
  collectGroups(parseDynamicPrompt(text), 0, text, groups);
  return groups;
}

export function hasDynamicPrompt(text: string): boolean {
  if (!text.includes('{')) return false;
  return parseDynamicPrompt(text).some((node) => node.type === 'group');
}

function resolveNodes(nodes: PromptNode[], random: () => number): string {
  let result = '';
  for (const node of nodes) {
    if (node.type === 'text') {
      result += node.value;
      continue;
    }
    // One draw per visited group, in document order; unchosen branches consume nothing.
    const draw = Math.min(0.999999999, Math.max(0, random()));
    const chosen = node.options[Math.floor(draw * node.options.length)] ?? [];
    result += resolveNodes(chosen, random);
  }
  return result;
}

function tidy(text: string): string {
  return text
    .replaceAll(/,(?:[^\S\n]*,)+/gu, ',')
    .replaceAll(/^[^\S\n]*,[^\S\n]*/gmu, '')
    .replaceAll(/[^\S\n]*,[^\S\n]*$/gmu, '')
    .replaceAll(/[^\S\n]{2,}/gu, ' ')
    .trim();
}

/** Resolves every group using `random` (floats in [0, 1)). */
export function resolveDynamicPrompt(
  text: string,
  random: () => number
): string {
  const nodes = parseDynamicPrompt(text);
  if (!nodes.some((node) => node.type === 'group')) {
    return renderNodes(nodes);
  }
  return tidy(resolveNodes(nodes, random));
}

/** Seed-tied resolution; `salt` separates streams (positive vs negative). */
export function resolveDynamicPromptWithSeed(
  text: string,
  seed: number,
  salt = ''
): string {
  if (!hasDynamicPrompt(text)) return text;
  return resolveDynamicPrompt(text, createSeededRandom(seed, salt));
}

function countNodes(nodes: PromptNode[]): number {
  let total = 1;
  for (const node of nodes) {
    if (node.type === 'text') continue;
    const optionCount = node.options.reduce(
      (sum, option) => sum + countNodes(option),
      0
    );
    total = Math.min(MAX_VARIANTS, total * Math.max(1, optionCount));
  }
  return total;
}

/** Number of distinct outcomes (capped at 1,000,000). 1 when static. */
export function countDynamicVariants(text: string): number {
  return countNodes(parseDynamicPrompt(text));
}
