<script setup lang="ts">
/**
 * PromptFindHighlight
 *
 * Overlay that renders search match highlights aligned pixel-perfectly on top
 * of a textarea by dynamically mirroring its computed styles at runtime.
 *
 * - Current match  → solid amber fill + amber outline  (VS Code current match)
 * - Other matches  → faint amber tint + amber outline  (VS Code other matches)
 * - `ranges`       → caller-supplied ranges with their own class, e.g.
 *                    `{a|b}` dynamic prompt groups (`ps-group`)
 *
 * Overlapping ranges are split into segments carrying every class involved.
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

interface FindMatch {
  start: number;
  end: number;
}

export interface HighlightRange extends FindMatch {
  cls: string;
}

const props = withDefaults(
  defineProps<{
    textareaEl: HTMLTextAreaElement | null;
    text: string;
    matches?: FindMatch[];
    currentMatchIndex?: number;
    active?: boolean;
    ranges?: HighlightRange[];
  }>(),
  {
    matches: () => [],
    currentMatchIndex: -1,
    active: false,
    ranges: () => []
  }
);

// ─── overlay ref ──────────────────────────────────────────────────────────────
const overlayRef = ref<HTMLDivElement | null>(null);

// Properties that affect text layout and must be mirrored exactly from textarea.
const MIRROR_PROPS = [
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'lineHeight',
  'letterSpacing',
  'wordSpacing',
  'tabSize',
  'textIndent',
  'textTransform',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderTopStyle',
  'borderRightStyle',
  'borderBottomStyle',
  'borderLeftStyle',
  'boxSizing',
  'direction'
] as const;

// ─── copy computed styles from textarea → overlay ─────────────────────────────
function syncStyles() {
  const ta = props.textareaEl;
  const ov = overlayRef.value;
  if (!ta || !ov) return;

  const cs = window.getComputedStyle(ta);
  for (const prop of MIRROR_PROPS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ov.style as any)[prop] = cs[prop];
  }

  // Border must be transparent (same width) so padding box is identical
  ov.style.borderColor = 'transparent';
  // Overlay must not scroll itself
  ov.style.overflow = 'hidden';
  // Text must be invisible — only the <mark> backgrounds show
  ov.style.color = 'transparent';
  ov.style.background = 'transparent';
  ov.style.pointerEvents = 'none';
  ov.style.userSelect = 'none';
  // Match textarea text-wrap behaviour
  ov.style.whiteSpace = 'pre-wrap';
  ov.style.wordWrap = 'break-word';
  ov.style.overflowWrap = 'break-word';
}

// ─── scroll sync ──────────────────────────────────────────────────────────────
function syncScroll() {
  const ta = props.textareaEl;
  const ov = overlayRef.value;
  if (!ta || !ov) return;
  ov.scrollTop = ta.scrollTop;
  ov.scrollLeft = ta.scrollLeft;
}

let rafId: number | null = null;
function onTextareaScroll() {
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => {
    syncScroll();
    rafId = null;
  });
}

watch(
  () => props.textareaEl,
  (el, oldEl) => {
    oldEl?.removeEventListener('scroll', onTextareaScroll);
    if (el) {
      el.addEventListener('scroll', onTextareaScroll, { passive: true });
      void nextTick(() => {
        syncStyles();
        syncScroll();
      });
    }
  },
  { immediate: true }
);

onMounted(() => {
  props.textareaEl?.addEventListener('scroll', onTextareaScroll, {
    passive: true
  });
  void nextTick(() => {
    syncStyles();
    syncScroll();
  });
});

onUnmounted(() => {
  props.textareaEl?.removeEventListener('scroll', onTextareaScroll);
  if (rafId !== null) cancelAnimationFrame(rafId);
});

// ─── build highlighted HTML ───────────────────────────────────────────────────
const allRanges = computed<HighlightRange[]>(() => {
  const ranges: HighlightRange[] = [];
  if (props.active) {
    props.matches.forEach(({ start, end }, index) => {
      ranges.push({
        start,
        end,
        cls: index === props.currentMatchIndex ? 'pf-current' : 'pf-other'
      });
    });
  }
  const length = props.text.length;
  for (const range of props.ranges) {
    const start = Math.max(0, Math.min(length, range.start));
    const end = Math.max(start, Math.min(length, range.end));
    if (end > start) ranges.push({ start, end, cls: range.cls });
  }
  return ranges;
});

const hasHighlights = computed(() => allRanges.value.length > 0);

const highlightedHtml = computed(() => {
  const text = props.text;
  const ranges = allRanges.value;
  if (ranges.length === 0 || !text) return '';

  // Split into non-overlapping segments; each carries every class covering it.
  const boundaries = new Set<number>([0, text.length]);
  for (const range of ranges) boundaries.add(range.start).add(range.end);
  const points = Array.from(boundaries).sort((a, b) => a - b);

  let result = '';
  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index];
    const end = points[index + 1];
    const classes = ranges
      .filter((range) => range.start <= start && range.end >= end)
      .map((range) => range.cls);
    const segment = escapeHtml(text.slice(start, end));
    result +=
      classes.length > 0
        ? `<mark class="${[...new Set(classes)].join(' ')}">${segment}</mark>`
        : segment;
  }

  // Sentinel keeps last line height correct
  result += '<span>\u200B</span>';
  return result;
});

// Re-sync styles + scroll after highlight HTML updates
watch(highlightedHtml, () => {
  void nextTick(() => {
    syncStyles();
    syncScroll();
  });
});

function escapeHtml(str: string) {
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\n', '<br>');
}
</script>

<template>
  <div
    v-if="hasHighlights"
    ref="overlayRef"
    aria-hidden="true"
    class="pf-overlay pointer-events-none absolute inset-0"
    v-html="highlightedHtml"
  />
</template>

<style scoped>
/* Base overlay — most styles are injected dynamically via syncStyles() */
.pf-overlay {
  position: absolute;
  inset: 0;
  overflow: hidden;
  color: transparent;
  background: transparent;
  pointer-events: none;
  user-select: none;
  /* Sit above the textarea's own background but below any floating dropdowns */
  z-index: 1;
}

/* Current match: solid amber fill + strong outline */
.pf-overlay :deep(.pf-current) {
  background-color: rgb(251 191 36 / 0.8);
  border-radius: 2px;
  color: transparent;
  outline: 2px solid rgb(245 158 11);
  outline-offset: 0;
}

/* Other matches: faint tint + subtle amber outline */
.pf-overlay :deep(.pf-other) {
  background-color: rgb(251 191 36 / 0.15);
  border-radius: 2px;
  color: transparent;
  outline: 1.5px solid rgb(251 191 36 / 0.65);
  outline-offset: 0;
}

/* Dynamic prompt `{a|b}` groups: soft primary tint so options stand out */
.pf-overlay :deep(.ps-group) {
  background-color: color-mix(in oklab, var(--primary) 16%, transparent);
  border-radius: 3px;
  box-shadow: inset 0 0 0 1px
    color-mix(in oklab, var(--primary) 40%, transparent);
  color: transparent;
}
</style>
