<script setup lang="ts">
import PromptSuggestionOptions from '@/components/prompt/PromptSuggestionOptions.vue';
import PromptChips from '@/components/prompt/PromptChips.vue';
import PromptFindHighlight, {
  type HighlightRange
} from '@/components/prompt/PromptFindHighlight.vue';
import PromptTagCatalog from '@/components/prompt/PromptTagCatalog.vue';
import {
  usePromptTextEditing,
  type PromptField
} from '@/composables/usePromptTextEditing';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import {
  ArrowRightLeft,
  Bookmark,
  Braces,
  Check,
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  HelpCircle,
  MoreHorizontal,
  Search,
  SlidersHorizontal,
  Sparkles,
  Tags,
  Trash2,
  X
} from '@lucide/vue';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { Textarea } from '@/components/ui/textarea';
import PromptPresetDialog from '../common/PromptPresetDialog.vue';
import PromptFormatMenu from '../common/PromptFormatMenu.vue';
import PromptEnhanceDialog from './PromptEnhanceDialog.vue';
import WorkflowField from './WorkflowField.vue';
import {
  estimateClipTokens,
  formatAndCleanPrompt,
  DEFAULT_FORMAT_OPTIONS
} from '../../utils/promptTools';
import {
  countDynamicVariants,
  findDynamicGroups,
  resolveDynamicPrompt
} from '../../utils/dynamicPrompt';
import { useWorkflowStore } from '../../stores/workflowStore';
import { loadAppData, saveAppData } from '../../services/appStorage';
import { toast } from 'vue-sonner';

const workflowStore = useWorkflowStore();

type PromptTextareaSizes = Record<PromptField, number>;

const TEXTAREA_SIZES_KEY = 'prompt_textarea_sizes';
const defaultTextareaSizes: PromptTextareaSizes = {
  positive: 96,
  negative: 80
};
const textareaSizes = ref<Partial<PromptTextareaSizes>>({});
const textareaSizesReady = ref(false);
const formatOptions = ref({ ...DEFAULT_FORMAT_OPTIONS });
let formatOptionsLoaded = false;
onMounted(async () => {
  try {
    const saved = await loadAppData<typeof formatOptions.value>(
      'prompt_format_options'
    );
    for (const key of Object.keys(
      DEFAULT_FORMAT_OPTIONS
    ) as (keyof typeof DEFAULT_FORMAT_OPTIONS)[]) {
      if (typeof saved?.[key] === 'boolean')
        formatOptions.value[key] = saved[key];
    }
  } catch (error) {
    console.warn('Failed to load prompt format options', error);
  } finally {
    formatOptionsLoaded = true;
  }
});
watch(
  formatOptions,
  (options) => {
    if (formatOptionsLoaded)
      void saveAppData('prompt_format_options', options).catch(console.error);
  },
  { deep: true }
);

async function loadTextareaSizes() {
  try {
    const saved =
      await loadAppData<Partial<PromptTextareaSizes>>(TEXTAREA_SIZES_KEY);
    if (!saved) return;
    for (const field of ['positive', 'negative'] as const) {
      const height = saved[field];
      if (typeof height === 'number' && height > 0) {
        textareaSizes.value[field] = height;
      }
    }
  } catch (error) {
    console.warn('Failed to load prompt textarea sizes:', error);
  } finally {
    await nextTick();
    textareaSizesReady.value = true;
  }
}

onMounted(loadTextareaSizes);

function saveTextareaSize(field: PromptField, event: PointerEvent) {
  const height = Math.round(
    (event.currentTarget as HTMLTextAreaElement).getBoundingClientRect().height
  );
  if (height === (textareaSizes.value[field] ?? defaultTextareaSizes[field])) {
    return;
  }
  textareaSizes.value[field] = height;
  void saveAppData(TEXTAREA_SIZES_KEY, textareaSizes.value).catch((error) =>
    console.error('Failed to save prompt textarea sizes:', error)
  );
}

const isPresetDialogOpen = ref(false);
const isEnhanceDialogOpen = ref(false);
const enhanceTarget = ref<'positive' | 'negative'>('positive');

function openEnhanceDialog(target: 'positive' | 'negative') {
  enhanceTarget.value = target;
  isEnhanceDialogOpen.value = true;
}

function handleEnhanceApply(payload: {
  mode: 'replace' | 'append';
  text: string;
  target: 'positive' | 'negative';
}) {
  if (payload.target === 'positive') {
    if (payload.mode === 'replace') {
      workflowStore.positivePrompt = payload.text;
    } else {
      workflowStore.positivePrompt = workflowStore.positivePrompt
        ? `${workflowStore.positivePrompt.replace(/,\s*$/u, '')}, ${payload.text}`
        : payload.text;
    }
  } else if (payload.mode === 'replace') {
    workflowStore.negativePrompt = payload.text;
  } else {
    workflowStore.negativePrompt = workflowStore.negativePrompt
      ? `${workflowStore.negativePrompt.replace(/,\s*$/u, '')}, ${payload.text}`
      : payload.text;
  }
}

// View modes
const isPositiveChipsMode = ref(false);
const isNegativeChipsMode = ref(false);
const {
  positiveTextarea,
  negativeTextarea,
  suggestions,
  activeIndex,
  activeField,
  getAutocompleteDropdownStyle,
  handleTextareaScroll,
  updateCursor,
  handleInput,
  handleBlur,
  selectSuggestion,
  handleKeydown,
  isFindBarOpen,
  findQuery,
  findTarget,
  findCaseSensitive,
  currentMatchIndex,
  findInputRef,
  findMatches,
  highlightCurrentMatch,
  findNext,
  findPrev,
  openFindBar,
  setFindTarget,
  closeFindBar,
  handleContainerKeydown,
  insertTagAtCursor
} = usePromptTextEditing(isPositiveChipsMode, isNegativeChipsMode);

const rawPositiveTextarea = computed<HTMLTextAreaElement | null>(() => {
  const comp = positiveTextarea.value;
  if (!comp) return null;
  return comp.$el instanceof HTMLTextAreaElement
    ? comp.$el
    : (comp as unknown as HTMLTextAreaElement);
});
const rawNegativeTextarea = computed<HTMLTextAreaElement | null>(() => {
  const comp = negativeTextarea.value;
  if (!comp) return null;
  return comp.$el instanceof HTMLTextAreaElement
    ? comp.$el
    : (comp as unknown as HTMLTextAreaElement);
});

// Copy feedback states
const copiedPositive = ref(false);
const copiedNegative = ref(false);

// Negative prompt bundle presets
const negativePresets = [
  {
    name: 'Standard Quality',
    description: 'General quality fixes, bad anatomy & blur',
    prompt:
      'worst quality, low quality, normal quality, lowres, blurry, bad anatomy, bad hands, missing fingers, extra digit, fewer digits'
  },
  {
    name: 'Anime / 2D Focus',
    description: 'Anime anatomy, bad eyes & proportions',
    prompt:
      'worst quality, low quality, blurry, bad proportions, bad eyes, extra limbs, extra arms, bad anatomy, deformed'
  },
  {
    name: 'Photorealistic / 3D',
    description: 'Avoid 3D CGI look, bad lighting & renders',
    prompt:
      'worst quality, low quality, 3d render, cartoon, illustration, drawing, painting, bad lighting, watermark, signature'
  },
  {
    name: 'Light / Minimal',
    description: 'Minimal cleanup, allows natural textures',
    prompt: 'worst quality, low quality, blurry, text, watermark'
  }
];

const positiveQuickGroups = [
  {
    label: 'Quality',
    tags: ['masterpiece', 'best quality', 'highly detailed', '8k resolution']
  },
  {
    label: 'Subject',
    tags: ['1girl', 'solo', 'scenery', 'close up', 'portrait']
  },
  {
    label: 'Lighting',
    tags: [
      'cinematic lighting',
      'volumetric lighting',
      'soft light',
      'sunlight'
    ]
  },
  {
    label: 'Style',
    tags: ['anime', 'photorealistic', 'digital art', 'depth of field']
  }
];

const negativeQuickTags = [
  'worst quality',
  'low quality',
  'blurry',
  'bad anatomy',
  'bad hands',
  'missing fingers',
  'extra digits',
  'watermark',
  'signature',
  'deformed',
  'mutated'
];

const selectedQuickGroup = ref(0);

function applyNegativePreset(presetPrompt: string) {
  if (workflowStore.negativePrompt.trim()) {
    // Append and format
    workflowStore.negativePrompt = formatAndCleanPrompt(
      `${workflowStore.negativePrompt}, ${presetPrompt}`
    );
  } else {
    workflowStore.negativePrompt = presetPrompt;
  }
}

function swapPrompts() {
  const temp = workflowStore.positivePrompt;
  workflowStore.positivePrompt = workflowStore.negativePrompt;
  workflowStore.negativePrompt = temp;
}

function formatPrompt(field: PromptField) {
  if (field === 'positive') {
    workflowStore.positivePrompt = formatAndCleanPrompt(
      workflowStore.positivePrompt,
      formatOptions.value
    );
  } else {
    workflowStore.negativePrompt = formatAndCleanPrompt(
      workflowStore.negativePrompt,
      formatOptions.value
    );
  }
}

async function copyPrompt(field: PromptField) {
  const text =
    field === 'positive'
      ? workflowStore.positivePrompt
      : workflowStore.negativePrompt;
  if (!text) return;
  await navigator.clipboard.writeText(text);
  if (field === 'positive') {
    copiedPositive.value = true;
    setTimeout(() => {
      copiedPositive.value = false;
    }, 1800);
  } else {
    copiedNegative.value = true;
    setTimeout(() => {
      copiedNegative.value = false;
    }, 1800);
  }
}

const positiveTokenInfo = computed(() =>
  estimateClipTokens(workflowStore.positivePrompt)
);
const negativeTokenInfo = computed(() =>
  estimateClipTokens(workflowStore.negativePrompt)
);

// Dynamic prompt `{a|b}` groups: highlighted in the editor and summarized in
// the field header. Outermost groups only, so nested groups share one mark.
function dynamicRanges(text: string): HighlightRange[] {
  return findDynamicGroups(text)
    .filter((group) => group.depth === 0)
    .map((group) => ({ start: group.start, end: group.end, cls: 'ps-group' }));
}
const positiveDynamicRanges = computed(() =>
  dynamicRanges(workflowStore.positivePrompt)
);
const negativeDynamicRanges = computed(() =>
  dynamicRanges(workflowStore.negativePrompt)
);
const positiveVariants = computed(() =>
  countDynamicVariants(workflowStore.positivePrompt)
);
const negativeVariants = computed(() =>
  countDynamicVariants(workflowStore.negativePrompt)
);

function previewDynamicRoll(field: PromptField) {
  const text =
    field === 'positive'
      ? workflowStore.positivePrompt
      : workflowStore.negativePrompt;
  toast(resolveDynamicPrompt(text, Math.random), {
    description: 'Example roll — each generation picks options from its seed.',
    duration: 6000
  });
}
</script>

<template>
  <div
    class="flex flex-col gap-3.5"
    :class="{ invisible: !textareaSizesReady }"
    @keydown="handleContainerKeydown"
  >
    <!-- Prompt In-Editor Find Bar (Ctrl+F) -->
    <div
      v-if="isFindBarOpen"
      class="border-border/80 bg-card/95 flex items-center justify-between gap-2 rounded-lg border p-1.5 px-2.5 shadow-md backdrop-blur-md transition-all"
    >
      <!-- Left: Target Selector + Input -->
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <div
          class="border-border/80 bg-secondary/70 flex shrink-0 items-center rounded-md border p-0.5 text-xs"
        >
          <button
            type="button"
            class="cursor-pointer rounded px-2 py-0.5 text-xs font-medium transition-colors select-none"
            :class="
              findTarget === 'positive'
                ? 'bg-primary text-primary-foreground font-semibold shadow-2xs'
                : 'text-muted-foreground hover:text-foreground'
            "
            @click="setFindTarget('positive')"
          >
            Positive
          </button>
          <button
            type="button"
            class="cursor-pointer rounded px-2 py-0.5 text-xs font-medium transition-colors select-none"
            :class="
              findTarget === 'negative'
                ? 'bg-primary text-primary-foreground font-semibold shadow-2xs'
                : 'text-muted-foreground hover:text-foreground'
            "
            @click="setFindTarget('negative')"
          >
            Negative
          </button>
        </div>

        <div class="relative flex min-w-36 flex-1 items-center">
          <Search
            class="text-muted-foreground pointer-events-none absolute left-2 h-3.5 w-3.5"
          />
          <input
            ref="findInputRef"
            v-model="findQuery"
            type="text"
            placeholder="Find"
            class="border-border bg-background placeholder:text-muted-foreground/60 focus:border-primary h-7 w-full rounded-md border pr-6 pl-7 font-mono text-xs outline-none"
            @keydown.enter.exact.prevent="findNext"
            @keydown.shift.enter.prevent="findPrev"
            @keydown.down.exact.prevent="findNext"
            @keydown.up.exact.prevent="findPrev"
            @keydown.esc.prevent="closeFindBar"
          />
          <button
            v-if="findQuery"
            type="button"
            class="text-muted-foreground hover:text-foreground absolute right-1.5 cursor-pointer"
            title="Clear search"
            @click="
              findQuery = '';
              findInputRef?.focus();
            "
          >
            <X class="h-3 w-3" />
          </button>
        </div>
      </div>

      <!-- Right: Match status + Prev/Next navigators + Case Sensitive + Close -->
      <div class="flex shrink-0 items-center gap-1">
        <span
          class="text-muted-foreground min-w-14 px-1 text-center font-mono text-xs"
        >
          {{
            findQuery
              ? findMatches.length > 0
                ? `${currentMatchIndex + 1} of ${findMatches.length}`
                : 'No matches'
              : ''
          }}
        </span>

        <!-- Case sensitive toggle -->
        <button
          type="button"
          class="h-6 cursor-pointer rounded border px-1.5 font-mono text-xs transition-colors"
          :class="
            findCaseSensitive
              ? 'border-primary/40 bg-primary/20 text-primary font-bold'
              : 'border-border/60 text-muted-foreground hover:text-foreground'
          "
          title="Match Case"
          @click="
            findCaseSensitive = !findCaseSensitive;
            highlightCurrentMatch();
          "
        >
          Aa
        </button>

        <!-- Previous match -->
        <button
          type="button"
          class="border-border/60 hover:bg-secondary text-muted-foreground hover:text-foreground inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded border transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="findMatches.length === 0"
          title="Previous Match (Shift+Enter / Up)"
          @click="findPrev"
        >
          <ChevronUp class="h-3.5 w-3.5" />
        </button>

        <!-- Next match -->
        <button
          type="button"
          class="border-border/60 hover:bg-secondary text-muted-foreground hover:text-foreground inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded border transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="findMatches.length === 0"
          title="Next Match (Enter / Down)"
          @click="findNext"
        >
          <ChevronDown class="h-3.5 w-3.5" />
        </button>

        <!-- Close Find Bar -->
        <button
          type="button"
          class="hover:bg-destructive/20 hover:text-destructive text-muted-foreground ml-0.5 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded transition-colors"
          title="Close (Escape)"
          @click="closeFindBar"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>

    <!-- 1. POSITIVE PROMPT SECTION -->
    <WorkflowField label="Positive Prompt">
      <template #label-extra>
        <Tooltip v-if="positiveDynamicRanges.length > 0">
          <TooltipTrigger as-child>
            <button
              type="button"
              class="border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 inline-flex h-5 cursor-pointer items-center gap-1 rounded-md border px-1.5 font-mono text-xs transition-colors"
              aria-label="Dynamic prompt groups in positive prompt"
              @click="previewDynamicRoll('positive')"
            >
              <Braces class="h-3 w-3" />
              <span>{{ positiveDynamicRanges.length }}</span>
              <span class="text-primary/70">·</span>
              <span>{{ positiveVariants.toLocaleString() }}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" class="max-w-xs text-xs">
            {{ positiveDynamicRanges.length }} dynamic
            {{ positiveDynamicRanges.length === 1 ? 'group' : 'groups' }} ·
            {{ positiveVariants.toLocaleString() }} possible variants. One
            option per group is picked from the seed at generation time. Click
            to preview a roll.
          </TooltipContent>
        </Tooltip>
      </template>
      <template #action>
        <div class="flex items-center gap-1.5">
          <!-- Shortcut Tip Tooltip -->
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                type="button"
                class="text-muted-foreground hover:text-foreground inline-flex cursor-help items-center gap-1 text-xs transition-colors"
              >
                <HelpCircle class="h-3 w-3" />
                <span>Shortcuts</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" class="max-w-xs p-2.5 text-xs">
              <div class="space-y-1.5">
                <p class="text-primary font-semibold">Prompt Shortcuts</p>
                <p
                  class="text-muted-foreground flex items-center justify-between gap-2"
                >
                  <span>Find in prompt</span>
                  <kbd
                    class="bg-muted border-border text-foreground rounded border px-1.5 py-0.5 font-mono text-xs"
                    >Ctrl + F</kbd
                  >
                </p>
                <p
                  class="text-muted-foreground flex items-center justify-between gap-2"
                >
                  <span>Adjust weight by ±0.05</span>
                  <kbd
                    class="bg-muted border-border text-foreground rounded border px-1.5 py-0.5 font-mono text-xs"
                    >Ctrl + Up/Down</kbd
                  >
                </p>
                <p
                  class="text-muted-foreground flex items-center justify-between gap-2"
                >
                  <span>Insert suggestion</span>
                  <kbd
                    class="bg-muted border-border text-foreground rounded border px-1.5 py-0.5 font-mono text-xs"
                    >Tab / Enter</kbd
                  >
                </p>
                <p
                  class="text-muted-foreground flex items-center justify-between gap-2"
                >
                  <span>Close suggestions</span>
                  <kbd
                    class="bg-muted border-border text-foreground rounded border px-1.5 py-0.5 font-mono text-xs"
                    >Esc</kbd
                  >
                </p>
              </div>
            </TooltipContent>
          </Tooltip>

          <span class="text-border">|</span>

          <!-- Presets Button -->
          <button
            type="button"
            class="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1 text-xs font-medium tracking-wide uppercase transition-colors"
            title="Prompt Presets (Save/Load to File)"
            @click="isPresetDialogOpen = true"
          >
            <Bookmark class="text-primary h-3 w-3" />
            <span>Presets</span>
          </button>

          <span class="text-border">|</span>

          <!-- Chips / Text Mode Toggle -->
          <button
            type="button"
            class="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1 text-xs font-medium transition-colors"
            :class="{ 'text-primary font-semibold': isPositiveChipsMode }"
            :title="
              isPositiveChipsMode
                ? 'Switch to Raw Text Editor'
                : 'Switch to Interactive Tag Chips'
            "
            @click="isPositiveChipsMode = !isPositiveChipsMode"
          >
            <Tags class="h-3 w-3" />
            <span>{{ isPositiveChipsMode ? 'Text' : 'Chips' }}</span>
          </button>

          <!-- AI Enhance Button -->
          <button
            type="button"
            class="text-primary hover:text-primary/80 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md transition-colors"
            title="Enhance prompt with AI"
            aria-label="Enhance positive prompt with AI"
            @click="openEnhanceDialog('positive')"
          >
            <Sparkles class="h-3 w-3" />
          </button>

          <!-- Find in Prompt Button -->
          <button
            type="button"
            class="hover:text-foreground inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md transition-colors"
            :class="
              isFindBarOpen && findTarget === 'positive'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground'
            "
            title="Find in prompt (Ctrl+F)"
            aria-label="Find in positive prompt"
            @click="
              isFindBarOpen && findTarget === 'positive'
                ? closeFindBar()
                : openFindBar('positive')
            "
          >
            <Search class="h-3 w-3" />
          </button>

          <span class="text-border">|</span>

          <!-- Format Button -->
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <button
                type="button"
                class="text-muted-foreground hover:text-foreground inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors"
                title="More prompt actions"
                aria-label="More positive prompt actions"
              >
                <MoreHorizontal class="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-48">
              <PromptFormatMenu
                v-model="formatOptions"
                :disabled="!workflowStore.positivePrompt.trim()"
                @format="formatPrompt('positive')"
              />
              <DropdownMenuItem @click="copyPrompt('positive')"
                ><Check v-if="copiedPositive" class="text-emerald-400" /><Copy
                  v-else
                /><span>{{
                  copiedPositive ? 'Copied' : 'Copy prompt'
                }}</span></DropdownMenuItem
              >
              <DropdownMenuItem @click="swapPrompts"
                ><ArrowRightLeft /><span>Swap prompts</span></DropdownMenuItem
              >
              <DropdownMenuItem
                variant="destructive"
                @click="workflowStore.positivePrompt = ''"
                ><Trash2 /><span>Clear prompt</span></DropdownMenuItem
              >
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </template>

      <!-- Positive Content: Either Textarea or Interactive Chips -->
      <div v-if="!isPositiveChipsMode" class="relative">
        <ContextMenu>
          <ContextMenuTrigger as-child>
            <Textarea
              ref="positiveTextarea"
              v-model="workflowStore.positivePrompt"
              :rows="4"
              :style="{
                height: `${textareaSizes.positive ?? defaultTextareaSizes.positive}px`
              }"
              placeholder="Describe the image you want to generate..."
              class="field-sizing-fixed min-h-24 w-full resize-y font-mono text-xs leading-relaxed"
              :class="{
                'caret-foreground bg-transparent':
                  positiveDynamicRanges.length > 0 ||
                  (isFindBarOpen &&
                    findTarget === 'positive' &&
                    findMatches.length > 0)
              }"
              @input="handleInput('positive', $event)"
              @scroll="handleTextareaScroll('positive', $event)"
              @click="updateCursor('positive', $event)"
              @keyup="updateCursor('positive', $event)"
              @select="updateCursor('positive', $event)"
              @keydown="handleKeydown('positive', $event)"
              @blur="handleBlur('positive', $event)"
              @pointerup="saveTextareaSize('positive', $event)"
            />
          </ContextMenuTrigger>
          <ContextMenuContent class="w-44">
            <ContextMenuItem
              :disabled="!workflowStore.positivePrompt.trim()"
              @select="formatPrompt('positive')"
            >
              <Code2 /> Format Prompt
            </ContextMenuItem>
            <ContextMenuItem
              :disabled="!workflowStore.positivePrompt"
              @select="copyPrompt('positive')"
            >
              <Copy /> Copy Prompt
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              :disabled="!workflowStore.positivePrompt"
              @select="workflowStore.positivePrompt = ''"
            >
              <Trash2 /> Clear Prompt
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        <!-- Search Match Highlight Overlay -->
        <PromptFindHighlight
          :textarea-el="rawPositiveTextarea"
          :text="workflowStore.positivePrompt"
          :matches="findMatches"
          :current-match-index="currentMatchIndex"
          :active="isFindBarOpen && findTarget === 'positive'"
          :ranges="positiveDynamicRanges"
        />

        <!-- Autocomplete Floating Dropdown -->
        <div
          v-if="activeField === 'positive'"
          ref="autocompleteListRef"
          role="listbox"
          :style="getAutocompleteDropdownStyle('positive')"
          class="border-border bg-popover/95 absolute z-50 max-h-56 overflow-y-auto rounded-lg border p-1 shadow-xl backdrop-blur-md"
        >
          <PromptSuggestionOptions
            :suggestions="suggestions"
            :active-index="activeIndex"
            @select="selectSuggestion('positive', $event)"
          />
        </div>
      </div>

      <!-- Interactive Tag Chips Mode -->
      <PromptChips
        v-show="isPositiveChipsMode"
        v-model="workflowStore.positivePrompt"
      />
      <!-- Categorized Quick Tags Bar -->
      <div class="flex flex-col gap-1.5 pt-0.5">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1">
            <span class="text-muted-foreground mr-1 text-xs font-semibold"
              >Quick:</span
            >
            <button
              v-for="(grp, idx) in positiveQuickGroups"
              :key="grp.label"
              type="button"
              class="cursor-pointer rounded px-1.5 py-0.5 text-xs font-medium transition-colors select-none"
              :class="
                selectedQuickGroup === idx
                  ? 'bg-primary text-primary-foreground font-semibold shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              "
              @mousedown.prevent
              @click="selectedQuickGroup = idx"
            >
              {{ grp.label }}
            </button>
          </div>

          <!-- Token Counter (Bottom Right) -->
          <span
            class="font-mono text-xs"
            :class="
              positiveTokenInfo.chunks > 1
                ? 'font-medium text-amber-400'
                : 'text-muted-foreground'
            "
            title="Estimated CLIP tokens"
          >
            {{ positiveTokenInfo.count }}/{{ positiveTokenInfo.maxChunk }}
          </span>
        </div>

        <div class="flex flex-wrap items-center gap-1.5">
          <button
            v-for="tag in positiveQuickGroups[selectedQuickGroup]?.tags"
            :key="tag"
            type="button"
            class="border-border bg-muted/60 text-muted-foreground hover:border-primary/40 hover:bg-accent hover:text-foreground cursor-pointer rounded border px-2 py-0.5 font-mono text-xs shadow-2xs transition-all select-none active:scale-95"
            title="Click to insert at cursor"
            @mousedown.prevent
            @click="insertTagAtCursor(tag, 'positive')"
          >
            + {{ tag }}
          </button>
        </div>
      </div>

      <!-- Categorized Prompt Library Accordion -->
      <PromptTagCatalog @insert="insertTagAtCursor" />
    </WorkflowField>

    <!-- 2. NEGATIVE PROMPT SECTION -->
    <WorkflowField label="Negative Prompt">
      <template #label-extra>
        <Tooltip v-if="negativeDynamicRanges.length > 0">
          <TooltipTrigger as-child>
            <button
              type="button"
              class="border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 inline-flex h-5 cursor-pointer items-center gap-1 rounded-md border px-1.5 font-mono text-xs transition-colors"
              aria-label="Dynamic prompt groups in negative prompt"
              @click="previewDynamicRoll('negative')"
            >
              <Braces class="h-3 w-3" />
              <span>{{ negativeDynamicRanges.length }}</span>
              <span class="text-primary/70">·</span>
              <span>{{ negativeVariants.toLocaleString() }}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" class="max-w-xs text-xs">
            {{ negativeDynamicRanges.length }} dynamic
            {{ negativeDynamicRanges.length === 1 ? 'group' : 'groups' }} ·
            {{ negativeVariants.toLocaleString() }} possible variants. Click to
            preview a roll.
          </TooltipContent>
        </Tooltip>
      </template>
      <template #action>
        <div class="flex items-center gap-1.5">
          <!-- Negative Presets Dropdown -->
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <button
                type="button"
                class="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1 text-xs font-medium tracking-wide uppercase transition-colors"
                title="Apply standard negative prompt preset"
              >
                <SlidersHorizontal class="text-primary h-3 w-3" />
                <span>Bundles</span>
                <ChevronDown class="h-3 w-3 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-56 p-1">
              <DropdownMenuItem
                v-for="np in negativePresets"
                :key="np.name"
                class="flex cursor-pointer flex-col items-start gap-0.5 py-1.5"
                @click="applyNegativePreset(np.prompt)"
              >
                <span class="text-foreground text-xs font-semibold">{{
                  np.name
                }}</span>
                <span class="text-muted-foreground line-clamp-1 text-xs">{{
                  np.description
                }}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <span class="text-border">|</span>

          <!-- Chips / Text Mode Toggle -->
          <button
            type="button"
            class="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1 text-xs font-medium transition-colors"
            :class="{ 'text-primary font-semibold': isNegativeChipsMode }"
            :title="
              isNegativeChipsMode
                ? 'Switch to Raw Text Editor'
                : 'Switch to Interactive Tag Chips'
            "
            @click="isNegativeChipsMode = !isNegativeChipsMode"
          >
            <Tags class="h-3 w-3" />
            <span>{{ isNegativeChipsMode ? 'Text' : 'Chips' }}</span>
          </button>

          <!-- AI Enhance Button -->
          <button
            type="button"
            class="text-primary hover:text-primary/80 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md transition-colors"
            title="Enhance negative prompt with AI"
            aria-label="Enhance negative prompt with AI"
            @click="openEnhanceDialog('negative')"
          >
            <Sparkles class="h-3 w-3" />
          </button>

          <!-- Find in Prompt Button -->
          <button
            type="button"
            class="hover:text-foreground inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md transition-colors"
            :class="
              isFindBarOpen && findTarget === 'negative'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground'
            "
            title="Find in prompt (Ctrl+F)"
            aria-label="Find in negative prompt"
            @click="
              isFindBarOpen && findTarget === 'negative'
                ? closeFindBar()
                : openFindBar('negative')
            "
          >
            <Search class="h-3 w-3" />
          </button>

          <span class="text-border">|</span>

          <!-- Format Button -->
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <button
                type="button"
                class="text-muted-foreground hover:text-foreground inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors"
                title="More prompt actions"
                aria-label="More negative prompt actions"
              >
                <MoreHorizontal class="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-48">
              <PromptFormatMenu
                v-model="formatOptions"
                :disabled="!workflowStore.negativePrompt.trim()"
                @format="formatPrompt('negative')"
              />
              <DropdownMenuItem @click="copyPrompt('negative')"
                ><Check v-if="copiedNegative" class="text-emerald-400" /><Copy
                  v-else
                /><span>{{
                  copiedNegative ? 'Copied' : 'Copy prompt'
                }}</span></DropdownMenuItem
              >
              <DropdownMenuItem
                variant="destructive"
                @click="workflowStore.negativePrompt = ''"
                ><Trash2 /><span>Clear prompt</span></DropdownMenuItem
              >
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </template>

      <!-- Negative Content: Textarea or Interactive Chips -->
      <div v-if="!isNegativeChipsMode" class="relative">
        <ContextMenu>
          <ContextMenuTrigger as-child>
            <Textarea
              ref="negativeTextarea"
              v-model="workflowStore.negativePrompt"
              :rows="3"
              :style="{
                height: `${textareaSizes.negative ?? defaultTextareaSizes.negative}px`
              }"
              placeholder="Things to avoid in generation..."
              class="field-sizing-fixed min-h-20 w-full resize-y font-mono text-xs leading-relaxed"
              :class="{
                'caret-foreground bg-transparent':
                  negativeDynamicRanges.length > 0 ||
                  (isFindBarOpen &&
                    findTarget === 'negative' &&
                    findMatches.length > 0)
              }"
              @input="handleInput('negative', $event)"
              @scroll="handleTextareaScroll('negative', $event)"
              @click="updateCursor('negative', $event)"
              @keyup="updateCursor('negative', $event)"
              @select="updateCursor('negative', $event)"
              @keydown="handleKeydown('negative', $event)"
              @blur="handleBlur('negative', $event)"
              @pointerup="saveTextareaSize('negative', $event)"
            />
          </ContextMenuTrigger>
          <ContextMenuContent class="w-44">
            <ContextMenuItem
              :disabled="!workflowStore.negativePrompt.trim()"
              @select="formatPrompt('negative')"
            >
              <Code2 /> Format Prompt
            </ContextMenuItem>
            <ContextMenuItem
              :disabled="!workflowStore.negativePrompt"
              @select="copyPrompt('negative')"
            >
              <Copy /> Copy Prompt
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              :disabled="!workflowStore.negativePrompt"
              @select="workflowStore.negativePrompt = ''"
            >
              <Trash2 /> Clear Prompt
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        <!-- Search Match Highlight Overlay -->
        <PromptFindHighlight
          :textarea-el="rawNegativeTextarea"
          :text="workflowStore.negativePrompt"
          :matches="findMatches"
          :current-match-index="currentMatchIndex"
          :active="isFindBarOpen && findTarget === 'negative'"
          :ranges="negativeDynamicRanges"
        />

        <!-- Autocomplete Floating Dropdown for Negative -->
        <div
          v-if="activeField === 'negative'"
          ref="autocompleteListRef"
          role="listbox"
          :style="getAutocompleteDropdownStyle('negative')"
          class="border-border bg-popover/95 absolute z-50 max-h-56 overflow-y-auto rounded-lg border p-1 shadow-xl backdrop-blur-md"
        >
          <PromptSuggestionOptions
            :suggestions="suggestions"
            :active-index="activeIndex"
            @select="selectSuggestion('negative', $event)"
          />
        </div>
      </div>

      <!-- Interactive Tag Chips Mode for Negative -->
      <PromptChips
        v-show="isNegativeChipsMode"
        v-model="workflowStore.negativePrompt"
        negative
      />
      <!-- Quick Negative Tags Bar -->
      <div class="flex items-center justify-between gap-1.5 pt-0.5">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="text-muted-foreground text-xs font-semibold"
            >Quick:</span
          >
          <button
            v-for="tag in negativeQuickTags"
            :key="tag"
            type="button"
            class="border-border bg-muted/60 text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive-foreground cursor-pointer rounded border px-2 py-0.5 font-mono text-xs shadow-2xs transition-all select-none active:scale-95"
            title="Click to insert into negative prompt"
            @mousedown.prevent
            @click="insertTagAtCursor(tag, 'negative')"
          >
            + {{ tag }}
          </button>
        </div>

        <!-- Token Counter for Negative (Bottom Right) -->
        <span
          class="shrink-0 font-mono text-xs"
          :class="
            negativeTokenInfo.chunks > 1
              ? 'font-medium text-amber-400'
              : 'text-muted-foreground'
          "
          title="Estimated CLIP tokens"
        >
          {{ negativeTokenInfo.count }}/{{ negativeTokenInfo.maxChunk }}
        </span>
      </div>
    </WorkflowField>

    <!-- Prompt Preset Manager Dialog -->
    <PromptPresetDialog v-model:open="isPresetDialogOpen" />

    <!-- AI Prompt Enhancer Diff Dialog -->
    <PromptEnhanceDialog
      v-model:open="isEnhanceDialogOpen"
      :target="enhanceTarget"
      :original-prompt="
        enhanceTarget === 'positive'
          ? workflowStore.positivePrompt
          : workflowStore.negativePrompt
      "
      @apply="handleEnhanceApply"
    />
  </div>
</template>
