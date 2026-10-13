<script setup lang="ts">
import { useEventListener, useResizeObserver } from '@vueuse/core';
import { computed, ref, watch } from 'vue';

const props = defineProps<{
  enabled: boolean;
  textareaEl: HTMLTextAreaElement | null;
  text: string;
}>();

const MIRRORED_STYLES = [
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'lineHeight',
  'letterSpacing',
  'wordSpacing',
  'paddingLeft',
  'paddingRight',
  'tabSize',
  'textTransform'
] as const;
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);

const mirrorRef = ref<HTMLDivElement | null>(null);
const lineHeights = ref<number[]>([]);
const gutterFont = ref({ fontSize: '', lineHeight: '' });
const paddingTop = ref('0px');
const scrollTop = ref(0);
const cursorLine = ref(0);
const focused = ref(false);

const textarea = computed(() => (props.enabled ? props.textareaEl : null));
const lines = computed(() => props.text.split('\n'));
const activeLine = computed(() =>
  Math.min(cursorLine.value, lines.value.length - 1)
);
const activeLineOffset = computed(() =>
  lineHeights.value
    .slice(0, activeLine.value)
    .reduce((sum, height) => sum + height, 0)
);

function measure() {
  const element = textarea.value;
  const mirror = mirrorRef.value;
  if (!element || !mirror) return;
  const style = getComputedStyle(element);
  for (const property of MIRRORED_STYLES) {
    mirror.style[property] = style[property];
  }
  mirror.style.width = `${element.clientWidth}px`;
  gutterFont.value = { fontSize: style.fontSize, lineHeight: style.lineHeight };
  paddingTop.value = style.paddingTop;
  scrollTop.value = element.scrollTop;
  lineHeights.value = Array.from(
    mirror.children,
    (row) => row.getBoundingClientRect().height
  );
}

function syncCursor() {
  const element = textarea.value;
  if (!element) return;
  cursorLine.value =
    element.value.slice(0, element.selectionStart).split('\n').length - 1;
}

watch([textarea, lines], measure, { immediate: true, flush: 'post' });
useResizeObserver([textarea, mirrorRef], measure);
useEventListener(
  textarea,
  'scroll',
  () => {
    scrollTop.value = textarea.value?.scrollTop ?? 0;
  },
  { passive: true }
);
useEventListener(
  textarea,
  ['selectionchange', 'input', 'keyup', 'click', 'focus'],
  syncCursor
);
useEventListener(textarea, 'focus', () => {
  focused.value = true;
});
useEventListener(textarea, 'blur', () => {
  focused.value = false;
});
</script>

<template>
  <slot v-if="!enabled" />
  <div
    v-else
    class="prompt-editor border-input dark:bg-input/30 focus-within:border-ring focus-within:ring-ring/50 relative flex rounded-md border shadow-xs transition-[color,box-shadow] focus-within:ring-3"
  >
    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-0 overflow-hidden rounded-md"
    >
      <div
        v-if="focused && lineHeights[activeLine]"
        class="bg-foreground/5 absolute inset-x-0"
        :style="{
          top: `calc(${paddingTop} + ${activeLineOffset - scrollTop}px)`,
          height: `${lineHeights[activeLine]}px`
        }"
      />
    </div>

    <div
      aria-hidden="true"
      class="bg-muted/40 border-border/60 text-muted-foreground/60 relative shrink-0 overflow-hidden rounded-l-md border-r font-mono tabular-nums select-none"
      :style="gutterFont"
    >
      <div class="invisible h-0 min-w-9 px-2">{{ lines.length }}</div>
      <div
        class="absolute inset-x-0 top-0"
        :style="{ paddingTop, transform: `translateY(${-scrollTop}px)` }"
      >
        <div
          v-for="(height, index) in lineHeights"
          :key="index"
          class="px-2 text-right"
          :class="{ 'text-foreground': focused && index === activeLine }"
          :style="{ height: `${height}px` }"
        >
          {{ index + 1 }}
        </div>
      </div>
      <div
        ref="mirrorRef"
        class="invisible absolute top-0 left-0 box-border wrap-break-word whitespace-pre-wrap"
      >
        <div v-for="(line, index) in lines" :key="index">
          {{ line || ZERO_WIDTH_SPACE }}
        </div>
      </div>
    </div>

    <div class="min-w-0 flex-1">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.prompt-editor :deep(textarea) {
  border: 0;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 20px;
  font-variant-ligatures: contextual;
  letter-spacing: 0;
  tab-size: 4;
}
</style>
