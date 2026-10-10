<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Clock, StickyNote } from '@lucide/vue';
import { formatShortDate } from '@/utils/formatters';
import type {
  CharacterData,
  LibraryListEntry,
  LoraData,
  PromptData
} from '@/types/library';

const props = defineProps<{ entry: LibraryListEntry }>();

const MAX_CHIPS = 6;

const PROMPT_SCOPES = {
  both: {
    label: 'Both',
    class: 'border-sky-500/30 bg-sky-500/15 text-sky-400'
  },
  positive: {
    label: '+ Pos',
    class: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400'
  },
  negative: {
    label: '− Neg',
    class: 'border-rose-500/30 bg-rose-500/15 text-rose-400'
  }
} as const;

const prompt = computed(() => props.entry.data as PromptData);
const promptScope = computed(
  () => PROMPT_SCOPES[prompt.value.type] ?? PROMPT_SCOPES.both
);
const loras = computed(() => (props.entry.data as LoraData).loras ?? []);
const character = computed(() => props.entry.data as CharacterData);
const characterTags = computed(() => character.value.tags ?? []);

const thumbnailFailed = ref(false);
watch(
  () => props.entry,
  () => {
    thumbnailFailed.value = false;
  }
);
const hasThumbnail = computed(
  () => Boolean(props.entry.thumbnailUrl) && !thumbnailFailed.value
);
</script>

<template>
  <article
    class="group border-border bg-card hover:border-primary/50 focus-within:border-primary/50 relative flex min-h-40 overflow-hidden rounded-xl border transition-all hover:shadow-md"
  >
    <div class="flex min-w-0 flex-1 flex-col p-3.5">
      <div class="min-w-0 flex-1">
        <div class="flex items-center justify-between gap-2">
          <span
            v-if="entry.category === 'prompts'"
            class="shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-xs font-bold uppercase"
            :class="promptScope.class"
          >
            {{ promptScope.label }}
          </span>
          <span
            v-else-if="entry.category === 'loras'"
            class="shrink-0 rounded-md border border-violet-500/30 bg-violet-500/15 px-1.5 py-0.5 font-mono text-xs font-bold text-violet-400 uppercase"
          >
            {{ loras.length }} LoRA{{ loras.length === 1 ? '' : 's' }}
          </span>
          <span
            v-else
            class="min-w-0 truncate rounded-md border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-xs font-bold text-amber-400"
            :title="character.series || 'No series set'"
          >
            {{ character.series || 'Original' }}
          </span>

          <span
            class="text-muted-foreground/70 flex shrink-0 items-center gap-1 font-mono text-xs"
          >
            <Clock class="h-2.5 w-2.5" />
            {{ formatShortDate(entry.updatedAt) }}
          </span>
        </div>

        <h3
          class="text-foreground mt-2 truncate text-sm leading-snug font-bold"
          :title="entry.name"
        >
          {{ entry.name }}
        </h3>
        <p
          v-if="entry.description"
          class="text-muted-foreground mt-0.5 line-clamp-1 text-xs leading-relaxed"
          :title="entry.description"
        >
          {{ entry.description }}
        </p>

        <!-- Prompt preview -->
        <div
          v-if="entry.category === 'prompts'"
          class="mt-2 flex flex-col gap-1"
        >
          <p
            v-if="prompt.positive"
            class="text-foreground/80 line-clamp-2 font-mono text-xs leading-relaxed"
            :title="prompt.positive"
          >
            <span class="mr-1 font-bold text-emerald-400">+</span
            >{{ prompt.positive }}
          </p>
          <p
            v-if="prompt.negative"
            class="text-muted-foreground font-mono text-xs leading-relaxed"
            :class="prompt.positive ? 'line-clamp-1' : 'line-clamp-2'"
            :title="prompt.negative"
          >
            <span class="mr-1 font-bold text-rose-400">−</span
            >{{ prompt.negative }}
          </p>
        </div>

        <!-- LoRA preview -->
        <div
          v-else-if="entry.category === 'loras'"
          class="mt-2 flex flex-wrap gap-1"
        >
          <span
            v-for="(lora, i) in loras.slice(0, MAX_CHIPS)"
            :key="i"
            class="border-border bg-muted/60 max-w-full truncate rounded border px-1.5 py-0.5 font-mono text-xs"
            :class="
              lora.enabled
                ? 'text-foreground/80'
                : 'text-muted-foreground line-through'
            "
            :title="`${lora.name} × ${lora.strength}${lora.enabled ? '' : ' (disabled)'}`"
          >
            {{ lora.name || '(No model)' }}
            <span class="text-primary">×{{ lora.strength }}</span>
          </span>
          <span
            v-if="loras.length > MAX_CHIPS"
            class="text-muted-foreground px-1 py-0.5 font-mono text-xs"
          >
            +{{ loras.length - MAX_CHIPS }} more
          </span>
          <span
            v-if="loras.length === 0"
            class="text-muted-foreground text-xs italic"
          >
            Empty stack
          </span>
        </div>

        <!-- Character preview -->
        <div v-else class="mt-2 flex flex-col gap-1.5">
          <p
            v-if="character.trigger"
            class="text-primary truncate font-mono text-xs font-semibold"
            :title="character.trigger"
          >
            {{ character.trigger }}
          </p>
          <div v-if="characterTags.length > 0" class="flex flex-wrap gap-1">
            <span
              v-for="tag in characterTags.slice(0, MAX_CHIPS)"
              :key="tag"
              class="border-border bg-muted/60 text-foreground/80 max-w-full truncate rounded border px-1.5 py-0.5 font-mono text-xs"
            >
              {{ tag }}
            </span>
            <span
              v-if="characterTags.length > MAX_CHIPS"
              class="text-muted-foreground px-1 py-0.5 font-mono text-xs"
            >
              +{{ characterTags.length - MAX_CHIPS }}
            </span>
          </div>
          <p
            v-if="character.notes"
            class="text-muted-foreground line-clamp-2 flex items-start gap-1 text-xs leading-relaxed italic"
            :title="character.notes"
          >
            <StickyNote class="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
            <span>{{ character.notes }}</span>
          </p>
        </div>
      </div>

      <div
        v-if="$slots.manage || $slots.apply"
        class="border-border/60 mt-3 flex items-center justify-between gap-2 border-t pt-2.5"
      >
        <div class="flex shrink-0 items-center gap-0.5">
          <slot name="manage" />
        </div>
        <div class="flex flex-wrap items-center justify-end gap-1.5">
          <slot name="apply" />
        </div>
      </div>
    </div>

    <div
      v-if="hasThumbnail"
      class="bg-muted/40 border-border/50 w-28 shrink-0 overflow-hidden border-l sm:w-32"
    >
      <img
        :src="entry.thumbnailUrl"
        :alt="entry.name"
        loading="lazy"
        decoding="async"
        class="h-full w-full object-cover object-center"
        @error="thumbnailFailed = true"
      />
    </div>
  </article>
</template>
