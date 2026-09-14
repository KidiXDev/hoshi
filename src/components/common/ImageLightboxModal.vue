<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue';
import {
  Check,
  Copy,
  Info,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut
} from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useOverlayLayer } from '@/composables/useOverlayLayer';
import type { WorkflowState } from '@/types/workflow';

interface Props {
  open: boolean;
  src?: string;
  alt?: string;
  title?: string;
  /** Generation data for the inspector side panel (hidden by default). */
  workflowState?: WorkflowState;
}

const props = withDefaults(defineProps<Props>(), {
  src: '',
  alt: 'Image Preview',
  title: ''
});

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'close'): void;
}>();
const { style: overlayStyle } = useOverlayLayer(
  () => props.open && Boolean(props.src)
);

const showInspector = ref(false);
const copied = ref<string | null>(null);
async function copyText(key: string, text?: string) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    copied.value = key;
    setTimeout(() => (copied.value = null), 2000);
  } catch {}
}
const promptTags = computed(() =>
  (props.workflowState?.positivePrompt ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
);
const enabledLoras = computed(() =>
  (props.workflowState?.loras ?? []).filter((lora) => lora.enabled)
);

const zoom = ref(1);
const panX = ref(0);
const panY = ref(0);
const isPanning = ref(false);
let startDragX = 0;
let startDragY = 0;
let startPanX = 0;
let startPanY = 0;
let hasDragged = false;

function resetPanAndZoom() {
  zoom.value = 1;
  panX.value = 0;
  panY.value = 0;
}

function handleClose() {
  emit('update:open', false);
  emit('close');
  resetPanAndZoom();
}

function handlePointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  isPanning.value = true;
  hasDragged = false;
  startDragX = event.clientX;
  startDragY = event.clientY;
  startPanX = panX.value;
  startPanY = panY.value;

  const onPointerMove = (e: PointerEvent) => {
    if (!isPanning.value) return;
    const dx = e.clientX - startDragX;
    const dy = e.clientY - startDragY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      hasDragged = true;
    }
    panX.value = startPanX + dx;
    panY.value = startPanY + dy;
  };

  const onPointerUp = () => {
    isPanning.value = false;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  };

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
}

function handleBackdropClick(event: MouseEvent) {
  if (hasDragged) {
    hasDragged = false;
    return;
  }
  if (event.target === event.currentTarget) {
    handleClose();
  }
}

function handleZoom(event: WheelEvent) {
  event.preventDefault();
  event.stopPropagation();
  const newZoom = Math.min(
    5,
    Math.max(1, Number((zoom.value - event.deltaY * 0.002).toFixed(2)))
  );
  if (newZoom === 1) {
    panX.value = 0;
    panY.value = 0;
  }
  zoom.value = newZoom;
}

function handleKeydown(event: KeyboardEvent) {
  if (!props.open) return;
  if (event.key === 'Escape') {
    handleClose();
  } else if ((event.key === 'i' || event.key === 'I') && props.workflowState) {
    showInspector.value = !showInspector.value;
  } else if (event.key === '+' || event.key === '=') {
    zoom.value = Math.min(5, Number((zoom.value + 0.25).toFixed(2)));
  } else if (event.key === '-') {
    zoom.value = Math.max(1, Number((zoom.value - 0.25).toFixed(2)));
    if (zoom.value === 1) {
      panX.value = 0;
      panY.value = 0;
    }
  } else if (event.key === '0') {
    resetPanAndZoom();
  }
}

watch(
  () => [props.open, props.src] as const,
  ([isOpen]) => {
    resetPanAndZoom();
    showInspector.value = false;
    if (isOpen) {
      window.addEventListener('keydown', handleKeydown);
    } else {
      window.removeEventListener('keydown', handleKeydown);
    }
  },
  { immediate: true }
);

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <Teleport defer to="#app-content">
    <Transition
      enter-active-class="transition-opacity duration-250 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-200 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open && src"
        class="absolute inset-0 z-50 flex overflow-hidden bg-black/70 backdrop-blur-md select-none"
        :style="overlayStyle"
      >
        <section
          class="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden"
          @click="handleBackdropClick"
          @wheel.prevent.stop="handleZoom"
        >
          <!-- Top Floating Header Overlay -->
          <div
            class="absolute top-0 right-0 left-0 z-20 flex items-center justify-between bg-linear-to-b from-black/80 via-black/40 to-transparent p-4"
            @click.stop
          >
            <!-- Left Title / Info -->
            <div class="flex items-center gap-3">
              <span
                v-if="title"
                class="max-w-md truncate font-mono text-xs font-semibold text-white/90"
                :title="title"
              >
                {{ title }}
              </span>
            </div>

            <!-- Right Action Controls -->
            <div class="flex items-center gap-2">
              <slot name="actions" />

              <Button
                v-if="workflowState"
                size="iconSm"
                variant="ghost"
                class="h-8 w-8 text-white/80 hover:bg-white/10 hover:text-white"
                :title="`${showInspector ? 'Hide' : 'Show'} Generation Data (I)`"
                @click="showInspector = !showInspector"
              >
                <PanelRightClose v-if="showInspector" class="h-4 w-4" />
                <PanelRightOpen v-else class="h-4 w-4" />
              </Button>

              <span
                class="rounded-md border border-white/10 bg-black/50 px-2 py-1 font-mono text-xs text-white/80 backdrop-blur-md"
              >
                {{ Math.round(zoom * 100) }}%
              </span>

              <Button
                size="iconSm"
                variant="ghost"
                class="h-8 w-8 text-white/80 hover:bg-white/10 hover:text-white"
                title="Zoom Out (-)"
                @click="
                  zoom = Math.max(1, Number((zoom - 0.25).toFixed(2)));
                  if (zoom === 1) {
                    panX = 0;
                    panY = 0;
                  }
                "
              >
                <ZoomOut class="h-4 w-4" />
              </Button>

              <Button
                size="iconSm"
                variant="ghost"
                class="h-8 w-8 text-white/80 hover:bg-white/10 hover:text-white"
                title="Zoom In (+)"
                @click="zoom = Math.min(5, Number((zoom + 0.25).toFixed(2)))"
              >
                <ZoomIn class="h-4 w-4" />
              </Button>

              <Button
                v-if="zoom !== 1 || panX !== 0 || panY !== 0"
                size="iconSm"
                variant="ghost"
                class="h-8 w-8 text-white/80 hover:bg-white/10 hover:text-white"
                title="Reset Zoom & Pan (0)"
                @click="resetPanAndZoom"
              >
                <RotateCcw class="h-3.5 w-3.5" />
              </Button>

              <Button
                size="iconSm"
                variant="ghost"
                class="hover:bg-destructive/80 h-8 w-8 text-white/80 hover:text-white"
                title="Close (Esc)"
                @click="handleClose"
              >
                <X class="h-4 w-4" />
              </Button>
            </div>
          </div>

          <!-- Fullscreen Image with Pan and Zoom -->
          <img
            :src="src"
            :alt="alt || title || 'Fullscreen Image'"
            draggable="false"
            class="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl select-none"
            :class="[
              isPanning
                ? 'cursor-grabbing duration-0'
                : 'cursor-grab transition-transform duration-100 ease-out'
            ]"
            :style="{
              transform: `translate3d(${panX}px, ${panY}px, 0px) scale(${zoom})`
            }"
            @pointerdown.stop="handlePointerDown"
            @wheel.prevent.stop="handleZoom"
            @dblclick.stop="zoom === 1 ? (zoom = 2) : resetPanAndZoom()"
          />

          <div
            v-if="$slots.footer"
            class="absolute right-4 bottom-4 left-4 z-20 flex justify-center"
            @click.stop
          >
            <slot name="footer" />
          </div>
        </section>

        <Transition
          enter-active-class="transition-transform duration-300 ease-out"
          enter-from-class="translate-x-full"
          enter-to-class="translate-x-0"
          leave-active-class="transition-transform duration-200 ease-in"
          leave-from-class="translate-x-0"
          leave-to-class="translate-x-full"
        >
          <aside
            v-if="showInspector && workflowState"
            class="border-border/80 bg-card/95 relative z-20 flex h-full w-105 max-w-[90vw] shrink-0 flex-col overflow-hidden border-l shadow-2xl backdrop-blur-xl"
            @click.stop
          >
            <div
              class="border-border/80 flex h-13 shrink-0 items-center justify-between border-b px-4"
            >
              <div class="flex items-center gap-2.5">
                <div
                  class="border-primary/30 bg-primary/10 text-primary flex h-7 w-7 items-center justify-center rounded-lg border"
                >
                  <Info class="h-4 w-4" />
                </div>
                <div>
                  <h2
                    class="text-foreground text-xs font-bold tracking-wide uppercase"
                  >
                    Generation Data
                  </h2>
                  <p class="text-muted-foreground text-xs">
                    Workflow parameters
                  </p>
                </div>
              </div>
              <Button
                size="iconSm"
                variant="ghost"
                class="text-muted-foreground hover:text-foreground h-8 w-8"
                title="Hide panel (I)"
                @click="showInspector = false"
              >
                <X class="h-4 w-4" />
              </Button>
            </div>

            <ScrollArea class="min-h-0 flex-1 overflow-hidden">
              <div class="flex flex-col gap-4 p-4 select-text">
                <div
                  class="border-border/80 bg-secondary/30 rounded-xl border p-3 font-mono text-xs"
                >
                  <dl class="grid grid-cols-[80px_1fr] gap-x-2 gap-y-2.5">
                    <dt class="text-muted-foreground">Model</dt>
                    <dd class="text-foreground font-semibold break-all">
                      {{ workflowState.models.unetName || '—' }}
                    </dd>

                    <dt class="text-muted-foreground">Sampler</dt>
                    <dd class="text-foreground font-medium">
                      {{ workflowState.sampler.samplerName || '—' }}
                    </dd>

                    <dt class="text-muted-foreground">Scheduler</dt>
                    <dd class="text-foreground font-medium">
                      {{ workflowState.sampler.scheduler || '—' }}
                    </dd>

                    <dt class="text-muted-foreground">Seed</dt>
                    <dd
                      class="flex items-center justify-between gap-1 break-all"
                    >
                      <span class="text-foreground font-semibold">{{
                        workflowState.sampler.seed
                      }}</span>
                      <Button
                        size="iconSm"
                        variant="ghost"
                        class="h-6 w-6 shrink-0"
                        title="Copy Seed"
                        @click="
                          copyText('seed', String(workflowState.sampler.seed))
                        "
                      >
                        <Check
                          v-if="copied === 'seed'"
                          class="h-3 w-3 text-emerald-400"
                        />
                        <Copy v-else class="h-3 w-3" />
                      </Button>
                    </dd>

                    <dt class="text-muted-foreground">Steps / CFG</dt>
                    <dd class="text-foreground font-medium">
                      {{ workflowState.sampler.steps }} /
                      {{ workflowState.sampler.cfg }}
                    </dd>

                    <dt class="text-muted-foreground">Resolution</dt>
                    <dd class="text-foreground font-medium">
                      {{
                        workflowState.resolution.width &&
                        workflowState.resolution.height
                          ? `${workflowState.resolution.width} × ${workflowState.resolution.height}`
                          : workflowState.resolution.preset || '—'
                      }}
                    </dd>

                    <dt class="text-muted-foreground">Mode</dt>
                    <dd class="text-foreground font-medium">
                      {{ workflowState.imageInput.mode }}
                      <template
                        v-if="workflowState.imageInput.mode !== 'text2img'"
                      >
                        · denoise {{ workflowState.sampler.denoise }}
                      </template>
                    </dd>

                    <template v-if="enabledLoras.length">
                      <dt class="text-muted-foreground">LoRAs</dt>
                      <dd
                        class="text-foreground flex flex-col gap-0.5 break-all"
                      >
                        <span v-for="lora in enabledLoras" :key="lora.id">
                          {{ lora.name }}
                          <span class="text-muted-foreground"
                            >@ {{ lora.strength }}</span
                          >
                        </span>
                      </dd>
                    </template>
                  </dl>
                </div>

                <section class="border-border/80 rounded-xl border p-3">
                  <div class="mb-2 flex items-center justify-between">
                    <h3
                      class="text-foreground text-xs font-bold tracking-wider uppercase"
                    >
                      Positive Prompt
                    </h3>
                    <Button
                      v-if="workflowState.positivePrompt"
                      size="sm"
                      variant="ghost"
                      class="text-muted-foreground hover:text-primary h-6 gap-1 px-2 text-xs"
                      @click="copyText('prompt', workflowState.positivePrompt)"
                    >
                      <Check
                        v-if="copied === 'prompt'"
                        class="h-3 w-3 text-emerald-400"
                      />
                      <Copy v-else class="h-3 w-3" />
                      <span>{{
                        copied === 'prompt' ? 'Copied!' : 'Copy'
                      }}</span>
                    </Button>
                  </div>
                  <div v-if="promptTags.length" class="flex flex-wrap gap-1.5">
                    <span
                      v-for="tag in promptTags"
                      :key="tag"
                      class="border-border/80 bg-muted/60 text-foreground rounded-md border px-2 py-0.5 font-mono text-xs break-all"
                    >
                      {{ tag }}
                    </span>
                  </div>
                  <p v-else class="text-muted-foreground text-xs italic">
                    No positive prompt.
                  </p>
                </section>

                <section
                  v-if="workflowState.negativePrompt"
                  class="border-border/80 rounded-xl border p-3"
                >
                  <div class="mb-2 flex items-center justify-between">
                    <h3
                      class="text-foreground text-xs font-bold tracking-wider uppercase"
                    >
                      Negative Prompt
                    </h3>
                    <Button
                      size="sm"
                      variant="ghost"
                      class="text-muted-foreground hover:text-primary h-6 gap-1 px-2 text-xs"
                      @click="copyText('neg', workflowState.negativePrompt)"
                    >
                      <Check
                        v-if="copied === 'neg'"
                        class="h-3 w-3 text-emerald-400"
                      />
                      <Copy v-else class="h-3 w-3" />
                      <span>{{ copied === 'neg' ? 'Copied!' : 'Copy' }}</span>
                    </Button>
                  </div>
                  <p
                    class="text-muted-foreground font-mono text-xs leading-relaxed whitespace-pre-wrap"
                  >
                    {{ workflowState.negativePrompt }}
                  </p>
                </section>
              </div>
            </ScrollArea>
          </aside>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
