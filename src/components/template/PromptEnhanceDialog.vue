<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  ArrowRight,
  Check,
  Copy,
  Loader2,
  Minus,
  Plus,
  Sparkles,
  Square,
  Wand2
} from '@lucide/vue';
import { streamText } from 'ai';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  buildEnhancerSystemPrompt,
  buildEnhancerUserPrompt,
  NEGATIVE_ENHANCE_PRESETS,
  POSITIVE_ENHANCE_PRESETS
} from '../../data/aiPrompts';
import { getOpenRouterModel } from '../../services/aiService';
import { useAiStore } from '../../stores/aiStore';
import AiModelSelector from '@/components/common/AiModelSelector.vue';
import AiReasoningSelector from '@/components/common/AiReasoningSelector.vue';

interface Props {
  open: boolean;
  originalPrompt: string;
  target?: 'positive' | 'negative';
}

const props = withDefaults(defineProps<Props>(), {
  target: 'positive'
});

const emit = defineEmits<{
  (e: 'update:open', val: boolean): void;
  (
    e: 'apply',
    payload: {
      mode: 'replace' | 'append';
      text: string;
      target: 'positive' | 'negative';
    }
  ): void;
}>();

const aiStore = useAiStore();

const selectedStyle = ref<string>('clothing');
const styleContext = ref('');
const customInstruction = ref('');
const enhancedPrompt = ref('');
const isStreaming = ref(false);
const errorMsg = ref('');
const copied = ref(false);
let abortController: AbortController | null = null;

const promptTarget = ref<'positive' | 'negative'>(props.target);

watch(
  () => props.target,
  (val) => {
    promptTarget.value = val;
  }
);

watch(promptTarget, (newTarget) => {
  const presets =
    newTarget === 'positive'
      ? POSITIVE_ENHANCE_PRESETS
      : NEGATIVE_ENHANCE_PRESETS;
  if (
    selectedStyle.value !== 'custom' &&
    !presets.some((p) => p.id === selectedStyle.value)
  ) {
    selectedStyle.value = presets[0].id;
  }
});

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      enhancedPrompt.value = '';
      errorMsg.value = '';
      copied.value = false;
      promptTarget.value = props.target;
      if (props.target === 'positive') {
        selectedStyle.value = 'clothing';
      }
    } else {
      stopEnhancement();
    }
  }
);

const currentPresets = computed(() =>
  promptTarget.value === 'positive'
    ? POSITIVE_ENHANCE_PRESETS
    : NEGATIVE_ENHANCE_PRESETS
);

const isCustomMode = computed(() => selectedStyle.value === 'custom');
const canRun = computed(
  () =>
    !isStreaming.value &&
    (!isCustomMode.value || !!customInstruction.value.trim())
);

function stopEnhancement() {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  isStreaming.value = false;
}

async function runEnhance() {
  if (!aiStore.hasApiKey) {
    errorMsg.value =
      'Please configure your OpenRouter API Key in Settings or the AI Drawer first.';
    return;
  }

  errorMsg.value = '';
  enhancedPrompt.value = '';
  isStreaming.value = true;
  abortController = new AbortController();

  const isPositive = promptTarget.value === 'positive';
  const presets = isPositive
    ? POSITIVE_ENHANCE_PRESETS
    : NEGATIVE_ENHANCE_PRESETS;
  const activePreset =
    presets.find((p) => p.id === selectedStyle.value) || presets[0];
  const styleInstruction = isCustomMode.value
    ? customInstruction.value.trim()
    : activePreset.instruction;
  if (!styleInstruction) {
    errorMsg.value = 'Enter an instruction for Custom mode.';
    isStreaming.value = false;
    return;
  }

  const userPrompt = buildEnhancerUserPrompt(
    isPositive,
    props.originalPrompt,
    styleInstruction,
    isCustomMode.value ? undefined : customInstruction.value,
    isCustomMode.value ? undefined : styleContext.value
  );

  try {
    const model = getOpenRouterModel(aiStore.config, aiStore.selectedModelInfo);

    const result = streamText({
      model,
      system: buildEnhancerSystemPrompt(
        aiStore.config.enhancerUsesAssistantInstruction
          ? aiStore.config.customSystemPrompt
          : aiStore.config.enhancerSystemPrompt
      ),
      prompt: userPrompt,
      temperature: aiStore.config.temperature,
      maxOutputTokens: aiStore.config.maxOutputTokens,
      abortSignal: abortController.signal
    });

    for await (const chunk of result.textStream) {
      enhancedPrompt.value += chunk;
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      // Aborted by user
    } else {
      errorMsg.value = err instanceof Error ? err.message : String(err);
    }
  } finally {
    isStreaming.value = false;
    abortController = null;
  }
}

function handleApply(mode: 'replace' | 'append') {
  if (!enhancedPrompt.value.trim()) return;
  emit('apply', {
    mode,
    text: enhancedPrompt.value.trim(),
    target: promptTarget.value
  });
  emit('update:open', false);
}

async function copyEnhanced() {
  if (!enhancedPrompt.value) return;
  try {
    await navigator.clipboard.writeText(enhancedPrompt.value);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(val) => emit('update:open', val)">
    <DialogContent
      class="border-border bg-card flex h-[85vh] w-full max-w-[min(64rem,calc(100vw-2rem))] min-w-[70vw] flex-col gap-0 overflow-hidden p-0 shadow-2xl"
    >
      <!-- Header -->
      <DialogHeader
        class="border-border bg-background/50 flex shrink-0 flex-row items-center justify-between border-b px-5 py-3.5"
      >
        <div class="flex items-center gap-2.5">
          <div
            class="bg-primary/10 text-primary border-primary/20 flex h-8 w-8 items-center justify-center rounded-lg border"
          >
            <Sparkles class="h-4 w-4" />
          </div>
          <div>
            <DialogTitle
              class="text-foreground text-sm font-bold tracking-tight"
            >
              AI Prompt Enhancer
            </DialogTitle>
            <DialogDescription class="text-muted-foreground text-xs">
              Rewrite the {{ promptTarget }} prompt with a preset or your own
              instruction
            </DialogDescription>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <ToggleGroup
            :model-value="promptTarget"
            type="single"
            variant="outline"
            :disabled="isStreaming"
            class="border-border bg-muted/60 h-8 rounded-md border p-0.5"
            @update:model-value="
              (val) => {
                if (val) promptTarget = val as 'positive' | 'negative';
              }
            "
          >
            <ToggleGroupItem
              value="positive"
              class="data-[state=on]:bg-background data-[state=on]:text-foreground h-7 gap-1.5 px-2.5 text-xs data-[state=on]:shadow-xs"
            >
              <Plus class="h-3 w-3 text-emerald-500" />
              Positive
            </ToggleGroupItem>
            <ToggleGroupItem
              value="negative"
              class="data-[state=on]:bg-background data-[state=on]:text-foreground h-7 gap-1.5 px-2.5 text-xs data-[state=on]:shadow-xs"
            >
              <Minus class="text-destructive h-3 w-3" />
              Negative
            </ToggleGroupItem>
          </ToggleGroup>
          <DialogCloseButton />
        </div>
      </DialogHeader>

      <!-- Body: sidebar controls + result pane -->
      <div class="flex min-h-0 flex-1">
        <!-- Sidebar -->
        <div
          class="border-border bg-background/40 flex w-72 shrink-0 flex-col border-r"
        >
          <ScrollArea class="min-h-0 flex-1">
            <div class="flex flex-col gap-4 p-4">
              <!-- Presets -->
              <div class="flex flex-col gap-1.5">
                <Label
                  class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
                >
                  Enhancement style
                </Label>
                <button
                  v-for="preset in currentPresets"
                  :key="preset.id"
                  type="button"
                  :title="preset.desc"
                  class="flex w-full cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-left transition-colors"
                  :class="
                    selectedStyle === preset.id
                      ? 'border-primary bg-primary/5 ring-primary/20 ring-1'
                      : 'border-border bg-card hover:border-primary/40 hover:bg-accent/40'
                  "
                  @click="selectedStyle = preset.id"
                >
                  <Wand2
                    class="h-3.5 w-3.5 shrink-0"
                    :class="
                      selectedStyle === preset.id
                        ? 'text-primary'
                        : 'text-muted-foreground'
                    "
                  />
                  <span class="text-foreground truncate text-xs font-semibold">
                    {{ preset.label }}
                  </span>
                </button>

                <button
                  type="button"
                  title="Apply a single instruction of your own"
                  class="flex w-full cursor-pointer items-center gap-2.5 rounded-lg border border-dashed px-2.5 py-1.5 text-left transition-colors"
                  :class="
                    isCustomMode
                      ? 'border-primary bg-primary/5 ring-primary/20 ring-1'
                      : 'border-border bg-card hover:border-primary/40 hover:bg-accent/40'
                  "
                  @click="selectedStyle = 'custom'"
                >
                  <Wand2
                    class="h-3.5 w-3.5 shrink-0"
                    :class="
                      isCustomMode ? 'text-primary' : 'text-muted-foreground'
                    "
                  />
                  <span class="text-foreground truncate text-xs font-semibold">
                    Custom
                  </span>
                </button>
              </div>

              <!-- Inputs -->
              <div class="flex flex-col gap-3">
                <div v-if="!isCustomMode" class="flex flex-col gap-1.5">
                  <Label
                    class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
                  >
                    Theme / universe
                    <span class="font-normal normal-case opacity-70">
                      (optional)
                    </span>
                  </Label>
                  <Textarea
                    v-model="styleContext"
                    placeholder="Enter theme or universe..."
                    rows="2"
                    class="bg-background/80 max-h-40 min-h-20 resize-y text-xs"
                    @keydown.ctrl.enter.prevent="runEnhance"
                  />
                </div>

                <div class="flex flex-col gap-1.5">
                  <Label
                    class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
                  >
                    {{ isCustomMode ? 'Instruction' : 'Extra instruction' }}
                    <span
                      v-if="!isCustomMode"
                      class="font-normal normal-case opacity-70"
                    >
                      (optional)
                    </span>
                  </Label>
                  <Textarea
                    v-model="customInstruction"
                    :placeholder="
                      isCustomMode
                        ? 'Enter your instruction...'
                        : 'Enter extra instructions...'
                    "
                    :rows="isCustomMode ? 4 : 3"
                    class="bg-background/80 max-h-40 min-h-20 resize-y"
                    @keydown.ctrl.enter.prevent="runEnhance"
                  />
                </div>
              </div>
            </div>
          </ScrollArea>

          <!-- Run -->
          <div class="border-border flex shrink-0 gap-2 border-t p-3">
            <Button
              v-if="isStreaming"
              type="button"
              variant="outline"
              size="sm"
              class="text-destructive hover:bg-destructive/10 gap-1.5"
              @click="stopEnhancement"
            >
              <Square class="h-3 w-3 fill-current" />
              Stop
            </Button>
            <Button
              type="button"
              size="sm"
              :disabled="!canRun"
              class="flex-1 gap-1.5"
              @click="runEnhance"
            >
              <Loader2 v-if="isStreaming" class="h-3.5 w-3.5 animate-spin" />
              <Sparkles v-else class="h-3.5 w-3.5" />
              {{ isStreaming ? 'Enhancing...' : 'Enhance prompt' }}
            </Button>
          </div>
        </div>

        <!-- Result pane -->
        <div class="flex min-w-0 flex-1 flex-col gap-3 p-4">
          <div
            v-if="errorMsg"
            class="bg-destructive/10 border-destructive/20 text-destructive shrink-0 rounded-lg border px-3 py-2 text-xs"
          >
            {{ errorMsg }}
          </div>

          <!-- Original -->
          <div
            class="border-border bg-muted/20 flex max-h-[30%] shrink-0 flex-col overflow-hidden rounded-xl border"
          >
            <div
              class="border-border bg-card/60 flex items-center justify-between border-b px-3 py-1.5"
            >
              <span
                class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
              >
                Original
              </span>
              <span class="text-muted-foreground font-mono text-xs">
                {{ originalPrompt.length }} chars
              </span>
            </div>
            <div
              class="text-foreground/80 min-h-0 overflow-y-auto p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap select-text"
            >
              {{ originalPrompt || '(Empty prompt)' }}
            </div>
          </div>

          <!-- Enhanced -->
          <div
            class="border-border bg-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border"
            :class="{ 'border-primary/40': isStreaming }"
          >
            <div
              class="border-border bg-primary/5 flex items-center justify-between border-b px-3 py-1.5"
            >
              <div class="flex items-center gap-1.5">
                <Sparkles class="text-primary h-3.5 w-3.5" />
                <span
                  class="text-primary text-xs font-bold tracking-wider uppercase"
                >
                  Enhanced
                </span>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-muted-foreground font-mono text-xs">
                  {{ enhancedPrompt.length }} chars
                </span>
                <Button
                  v-if="enhancedPrompt"
                  variant="ghost"
                  size="iconXs"
                  class="text-muted-foreground hover:text-foreground"
                  title="Copy to clipboard"
                  @click="copyEnhanced"
                >
                  <Check v-if="copied" class="text-emerald-500" />
                  <Copy v-else />
                </Button>
              </div>
            </div>

            <div
              v-if="enhancedPrompt"
              class="min-h-0 flex-1 overflow-y-auto p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap select-text"
            >
              {{ enhancedPrompt
              }}<span
                v-if="isStreaming"
                class="bg-primary ml-0.5 inline-block h-3 w-1.5 animate-pulse align-middle"
              />
            </div>
            <div
              v-else
              class="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center"
            >
              <div
                class="bg-muted flex h-12 w-12 items-center justify-center rounded-full"
              >
                <Loader2
                  v-if="isStreaming"
                  class="text-primary h-5 w-5 animate-spin"
                />
                <Sparkles v-else class="h-5 w-5 opacity-40" />
              </div>
              <span class="text-foreground text-xs font-semibold">
                {{ isStreaming ? 'Generating...' : 'Nothing generated yet' }}
              </span>
              <p v-if="!isStreaming" class="max-w-xs text-xs">
                Pick a style on the left and press
                <span class="text-foreground font-medium">Enhance prompt</span>.
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div
        class="border-border bg-muted/40 flex shrink-0 items-center justify-between gap-3 border-t px-4 py-2.5"
      >
        <div class="flex min-w-0 items-center gap-1.5">
          <AiModelSelector compact />
          <AiReasoningSelector compact :disabled="isStreaming" />
        </div>

        <div class="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            @click="emit('update:open', false)"
          >
            Close
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            :disabled="!enhancedPrompt || isStreaming"
            @click="handleApply('append')"
          >
            Append
          </Button>
          <Button
            type="button"
            size="sm"
            :disabled="!enhancedPrompt || isStreaming"
            class="gap-1.5"
            @click="handleApply('replace')"
          >
            <ArrowRight class="h-3.5 w-3.5" />
            Replace {{ promptTarget }}
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
