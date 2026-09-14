<script setup lang="ts">
import { computed, ref } from 'vue';
import { dragHistoryImage } from '@/services/imageGallery';
import {
  Check,
  Clock,
  Copy,
  Cpu,
  Download,
  Eye,
  History,
  Inbox,
  Layers,
  MoreHorizontal,
  RotateCcw,
  Scaling,
  ScanFace,
  Search,
  Sparkles,
  Trash2,
  WandSparkles,
  X
} from '@lucide/vue';
import { useRouter } from 'vue-router';
import ImageLightboxModal from '@/components/common/ImageLightboxModal.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { useComfyStore } from '../../stores/comfyStore';
import { useHistoryStore } from '../../stores/historyStore';
import { useImageTransferStore } from '../../stores/imageTransferStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import type { HistoryItem } from '../../types/workflow';

const router = useRouter();
const historyStore = useHistoryStore();
const workflowStore = useWorkflowStore();
const comfyStore = useComfyStore();
const transferStore = useImageTransferStore();

const searchQuery = ref('');
const copiedId = ref<string | null>(null);
const inspectingItem = ref<HistoryItem | null>(null);

async function handleSendToUpscaler(url: string, filename: string) {
  await transferStore.sendToUpscaler(url, filename);
  inspectingItem.value = null;
  historyStore.isDrawerOpen = false;
  void router.push('/upscaler');
}

async function handleSendToRmbg(url: string, filename: string) {
  await transferStore.sendToRmbg(url, filename);
  inspectingItem.value = null;
  historyStore.isDrawerOpen = false;
  void router.push('/remove-bg');
}

async function handleSendToFaceDetailer(url: string, filename: string) {
  await transferStore.sendToFaceDetailer(url, filename);
  inspectingItem.value = null;
  historyStore.isDrawerOpen = false;
  void router.push('/face-detailer');
}

const filteredItems = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) return historyStore.items;
  return historyStore.items.filter((item) => {
    const prompt = item.workflowState.positivePrompt?.toLowerCase() || '';
    const neg = item.workflowState.negativePrompt?.toLowerCase() || '';
    const model = item.workflowState.models?.unetName?.toLowerCase() || '';
    const seed = String(item.workflowState.sampler?.seed || '');
    const sampler =
      item.workflowState.sampler?.samplerName?.toLowerCase() || '';
    return (
      prompt.includes(query) ||
      neg.includes(query) ||
      model.includes(query) ||
      seed.includes(query) ||
      sampler.includes(query)
    );
  });
});

function applyHistorySettings(item: HistoryItem) {
  workflowStore.applyWorkflowState(item.workflowState);
  comfyStore.lastGeneratedImage = {
    url: item.imageUrl,
    filename: item.filename,
    subfolder: item.subfolder,
    type: item.type,
    promptId: item.promptId,
    workflowState: item.workflowState,
    durationMs: item.durationMs ?? 0
  };
  historyStore.isDrawerOpen = false;
}

function applyPromptOnly(item: HistoryItem) {
  const { workflowState } = item;
  workflowStore.positivePrompt =
    workflowState.promptTemplates?.positivePrompt ??
    workflowState.positivePrompt ??
    '';
  workflowStore.negativePrompt =
    workflowState.promptTemplates?.negativePrompt ??
    workflowState.negativePrompt ??
    '';
  triggerCopyFeedback(item.id, 'prompt-applied');
}

function downloadHistoryImage(item: HistoryItem) {
  const a = document.createElement('a');
  a.href = item.imageUrl;
  a.download = item.filename || 'generated-image.png';
  document.body.append(a);
  a.click();
  a.remove();
}

async function copyText(text: string, id: string) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    triggerCopyFeedback(id, 'copied');
  } catch (error) {
    console.error('Failed to copy text:', error);
  }
}

function triggerCopyFeedback(id: string, actionType: string) {
  copiedId.value = `${id}-${actionType}`;
  setTimeout(() => {
    if (copiedId.value === `${id}-${actionType}`) {
      copiedId.value = null;
    }
  }, 1800);
}

function formatResolution(item: HistoryItem): string {
  const res = item.workflowState.resolution;
  if (res?.width && res?.height) {
    return `${res.width}×${res.height}`;
  }
  if (res?.preset && res.preset !== 'Custom') {
    const match = res.preset.match(/^(\d+\s*x\s*\d+)/iu);
    if (match) return match[1].replaceAll(/\s+/gu, '');
  }
  return '1024×1024';
}

function formatModelName(name?: string): string {
  if (!name) return 'Diffusion';
  const clean = name.replace(/\.[^.]+$/u, '');
  return clean.length > 24 ? `${clean.slice(0, 22)}...` : clean;
}
</script>

<template>
  <Sheet v-model:open="historyStore.isDrawerOpen">
    <SheetContent
      side="right"
      class="border-border bg-card/95 text-foreground flex h-full w-full min-w-[50vw] flex-col overflow-hidden border-l p-0 backdrop-blur-md xl:min-w-[46vw]"
    >
      <!-- Header Bar -->
      <SheetHeader
        class="border-border bg-card/60 flex h-14 shrink-0 flex-row items-center justify-between border-b px-4 backdrop-blur-xs"
      >
        <div class="flex items-center gap-2.5">
          <div
            class="border-primary/30 bg-primary/10 text-primary flex h-8 w-8 items-center justify-center rounded-lg border shadow-2xs"
          >
            <History class="h-4 w-4" />
          </div>
          <div>
            <div class="flex items-center gap-2">
              <SheetTitle
                class="text-foreground text-xs font-bold tracking-wider uppercase"
              >
                Generation History
              </SheetTitle>
              <Badge
                v-if="historyStore.items.length > 0"
                variant="secondary"
                class="font-mono text-xs"
              >
                {{ historyStore.items.length }}
              </Badge>
            </div>
            <p class="text-muted-foreground text-xs">
              Session history with full workflow states and prompt recovery.
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2 pr-6">
          <Button
            v-if="historyStore.items.length > 0"
            size="sm"
            variant="ghost"
            class="text-muted-foreground hover:text-destructive h-7 px-2 text-xs"
            title="Clear all session history"
            @click="historyStore.clearHistory"
          >
            <Trash2 class="mr-1 h-3.5 w-3.5" />
            <span>Clear All</span>
          </Button>
        </div>
      </SheetHeader>

      <!-- Search & Filter Toolbar -->
      <div
        v-if="historyStore.items.length > 0"
        class="border-border bg-muted/20 flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2"
      >
        <div class="relative flex-1">
          <Search
            class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2"
          />
          <Input
            v-model="searchQuery"
            type="text"
            placeholder="Filter by prompt, model, seed, or sampler..."
            class="h-8 pr-7 pl-8 text-xs"
          />
          <button
            v-if="searchQuery"
            type="button"
            class="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 h-4 w-4 -translate-y-1/2"
            @click="searchQuery = ''"
          >
            <X class="h-3.5 w-3.5" />
          </button>
        </div>

        <span class="text-muted-foreground shrink-0 font-mono text-xs">
          Showing {{ filteredItems.length }} of {{ historyStore.items.length }}
        </span>
      </div>

      <!-- Main Single Column Body Container -->
      <div class="flex-1 overflow-y-auto p-4">
        <!-- Empty State -->
        <div
          v-if="historyStore.items.length === 0"
          class="text-muted-foreground flex h-full flex-col items-center justify-center py-28 text-center"
        >
          <div
            class="border-border bg-secondary flex h-16 w-16 items-center justify-center rounded-2xl border shadow-sm"
          >
            <Inbox class="text-muted-foreground/60 h-8 w-8" />
          </div>
          <p class="mt-3 text-sm font-bold">No history in this session yet</p>
          <p class="text-muted-foreground/80 mt-1 max-w-xs text-xs">
            Generated images will be tracked here with full reproducible
            workflow parameters.
          </p>
        </div>

        <!-- No Filter Results -->
        <div
          v-else-if="filteredItems.length === 0"
          class="text-muted-foreground flex h-full flex-col items-center justify-center py-20 text-center"
        >
          <Search class="text-muted-foreground/40 mb-2 h-8 w-8" />
          <p class="text-xs font-semibold">
            No results match "{{ searchQuery }}"
          </p>
          <Button
            variant="link"
            size="sm"
            class="mt-1 text-xs"
            @click="searchQuery = ''"
          >
            Reset Search
          </Button>
        </div>

        <div v-else class="flex flex-col gap-3.5">
          <div
            v-for="item in filteredItems"
            :key="item.id"
            class="border-border bg-card/70 hover:border-primary/50 group flex flex-col gap-3 rounded-xl border p-3.5 shadow-2xs transition-all sm:flex-row"
          >
            <!-- Highlight Portrait Image Box -->
            <ContextMenu>
              <ContextMenuTrigger as-child>
                <div
                  class="border-border bg-background group/img relative h-56 w-full shrink-0 cursor-pointer overflow-hidden rounded-lg border shadow-xs sm:h-56 sm:w-44"
                  @click="inspectingItem = item"
                  :draggable="!!item.imageUrl"
                  @dragstart="dragHistoryImage($event, item)"
                >
                  <img
                    v-if="item.imageUrl"
                    draggable="false"
                    :src="item.imageUrl"
                    :alt="item.filename"
                    class="h-full w-full object-cover transition-transform duration-300 group-hover/img:scale-105"
                  />

                  <!-- Hover Zoom Cue Overlay -->
                  <div
                    class="bg-background/60 absolute inset-0 flex flex-col items-center justify-center gap-1.5 opacity-0 backdrop-blur-xs transition-opacity group-hover/img:opacity-100"
                  >
                    <div
                      class="border-primary/30 bg-primary/20 text-primary flex h-9 w-9 items-center justify-center rounded-full border shadow-sm"
                    >
                      <Eye class="h-4.5 w-4.5" />
                    </div>
                    <span
                      class="font-mono text-xs font-bold text-white shadow-xs"
                    >
                      Inspect
                    </span>
                  </div>

                  <!-- Top Left Aspect/Type Pill -->
                  <span
                    class="bg-background/80 text-foreground border-border/60 absolute top-2 left-2 rounded border px-1.5 py-0.5 font-mono text-xs font-semibold shadow-xs backdrop-blur-xs"
                  >
                    {{ formatResolution(item) }}
                  </span>

                  <!-- Bottom Duration Pill -->
                  <span
                    v-if="item.durationMs"
                    class="bg-background/85 text-muted-foreground absolute right-2 bottom-2 rounded px-1.5 py-0.5 font-mono text-xs font-semibold shadow-xs backdrop-blur-xs"
                  >
                    ⏱ {{ (item.durationMs / 1000).toFixed(1) }}s
                  </span>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent class="w-52">
                <ContextMenuItem @select="inspectingItem = item">
                  <Eye /> Inspect Image
                </ContextMenuItem>
                <ContextMenuItem @select="applyHistorySettings(item)">
                  <RotateCcw /> Apply Settings
                </ContextMenuItem>
                <ContextMenuItem @select="downloadHistoryImage(item)">
                  <Download /> Download Image
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  @select="handleSendToUpscaler(item.imageUrl, item.filename)"
                >
                  <Scaling /> Send to Upscaler
                </ContextMenuItem>
                <ContextMenuItem
                  @select="handleSendToRmbg(item.imageUrl, item.filename)"
                >
                  <WandSparkles /> Send to RMBG
                </ContextMenuItem>
                <ContextMenuItem
                  @select="
                    handleSendToFaceDetailer(item.imageUrl, item.filename)
                  "
                >
                  <ScanFace /> Send to Face Detailer
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  variant="destructive"
                  @select="historyStore.removeHistory(item.id)"
                >
                  <Trash2 /> Remove from History
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>

            <div class="flex min-w-0 flex-1 flex-col justify-between gap-2.5">
              <!-- Top Row: Timestamp, Model Name -->
              <div class="flex items-center justify-between gap-2">
                <Button
                  variant="ghost"
                  size="iconSm"
                  title="Remove from history"
                  aria-label="Remove from history"
                  @click="historyStore.removeHistory(item.id)"
                >
                  <Trash2 class="h-3.5 w-3.5" />
                </Button>
                <span
                  class="text-muted-foreground flex items-center gap-1.5 font-mono text-xs"
                >
                  <Clock class="h-3.5 w-3.5" />
                  {{ new Date(item.timestamp).toLocaleTimeString() }} •
                  <span class="text-muted-foreground/70">{{
                    new Date(item.timestamp).toLocaleDateString()
                  }}</span>
                </span>

                <Badge
                  v-if="item.workflowState.models?.unetName"
                  variant="outline"
                  class="border-border max-w-56 truncate font-mono text-xs font-semibold"
                  :title="item.workflowState.models.unetName"
                >
                  <Cpu class="text-primary mr-1 h-3 w-3" />
                  {{ formatModelName(item.workflowState.models.unetName) }}
                </Badge>
              </div>

              <!-- Positive Prompt Box with Quick Copy -->
              <div
                class="border-border bg-secondary/20 relative flex flex-col gap-1 rounded-lg border p-2.5"
              >
                <div class="flex items-center justify-between">
                  <span
                    class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
                  >
                    Positive Prompt
                  </span>
                  <button
                    type="button"
                    class="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1 text-xs transition-colors"
                    title="Copy Positive Prompt"
                    @click="
                      copyText(item.workflowState.positivePrompt || '', item.id)
                    "
                  >
                    <Check
                      v-if="copiedId === `${item.id}-copied`"
                      class="h-3 w-3 text-emerald-400"
                    />
                    <Copy v-else class="h-3 w-3" />
                    <span>{{
                      copiedId === `${item.id}-copied` ? 'Copied!' : 'Copy'
                    }}</span>
                  </button>
                </div>
                <p
                  class="text-foreground/90 line-clamp-3 font-mono text-xs leading-relaxed select-text"
                >
                  "{{
                    item.workflowState.positivePrompt || 'No positive prompt'
                  }}"
                </p>
              </div>

              <!-- Negative Prompt (if present) -->
              <div
                v-if="item.workflowState.negativePrompt"
                class="text-muted-foreground flex items-center gap-1.5 font-mono text-xs"
              >
                <span class="text-destructive/80 font-bold uppercase"
                  >Negative:</span
                >
                <span class="truncate">{{
                  item.workflowState.negativePrompt
                }}</span>
              </div>

              <!-- Active LoRA Stack Chips (if any) -->
              <div
                v-if="
                  item.workflowState.loras &&
                  item.workflowState.loras.filter((l) => l.enabled).length > 0
                "
                class="flex flex-wrap items-center gap-1.5"
              >
                <span
                  class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
                >
                  LoRAs:
                </span>
                <span
                  v-for="lora in item.workflowState.loras.filter(
                    (l) => l.enabled
                  )"
                  :key="lora.id"
                  class="border-primary/25 bg-primary/10 text-primary inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs font-semibold shadow-2xs"
                >
                  <Layers class="h-2.5 w-2.5" />
                  {{ lora.name.replace(/\.[^.]+$/u, '') }} ({{ lora.strength }})
                </span>
              </div>

              <!-- Parameter Matrix -->
              <div
                class="border-border bg-secondary/30 grid grid-cols-2 gap-2 rounded-lg border p-2 font-mono text-xs sm:grid-cols-4"
              >
                <div class="flex items-center justify-between">
                  <span class="text-muted-foreground">Seed:</span>
                  <button
                    type="button"
                    class="text-foreground hover:text-primary inline-flex cursor-pointer items-center gap-1 font-semibold transition-colors"
                    title="Click to copy seed"
                    @click="
                      copyText(
                        String(item.workflowState.sampler?.seed),
                        item.id
                      )
                    "
                  >
                    <span>{{ item.workflowState.sampler?.seed }}</span>
                    <Copy class="h-2.5 w-2.5 opacity-50" />
                  </button>
                </div>

                <div class="flex items-center justify-between">
                  <span class="text-muted-foreground">Steps / CFG:</span>
                  <span class="text-foreground font-semibold">
                    {{ item.workflowState.sampler?.steps }} /
                    {{ item.workflowState.sampler?.cfg }}
                  </span>
                </div>

                <div class="flex items-center justify-between">
                  <span class="text-muted-foreground">Sampler:</span>
                  <span class="text-foreground max-w-28 truncate font-semibold">
                    {{ item.workflowState.sampler?.samplerName }}
                  </span>
                </div>

                <div class="flex items-center justify-between">
                  <span class="text-muted-foreground">Scheduler:</span>
                  <span class="text-foreground font-semibold">
                    {{ item.workflowState.sampler?.scheduler }}
                  </span>
                </div>
              </div>

              <!-- Actions Row -->
              <div
                class="border-border flex flex-wrap items-center justify-between gap-2 border-t pt-2.5"
              >
                <div class="flex items-center gap-2">
                  <Button
                    size="sm"
                    class="h-7 gap-1.5 px-3 text-xs font-semibold shadow-2xs"
                    @click="applyHistorySettings(item)"
                  >
                    <RotateCcw class="h-3.5 w-3.5" />
                    <span>Reuse All Settings</span>
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    class="h-7 gap-1 px-2 text-xs"
                    title="Apply positive and negative prompt only"
                    @click="applyPromptOnly(item)"
                  >
                    <Sparkles class="h-3 w-3 text-amber-400" />
                    <span>
                      {{
                        copiedId === `${item.id}-prompt-applied`
                          ? 'Applied!'
                          : 'Prompt Only'
                      }}
                    </span>
                  </Button>
                </div>

                <div class="flex items-center gap-1">
                  <!-- Card Quick Transfer Dropdown -->
                  <DropdownMenu>
                    <DropdownMenuTrigger as-child>
                      <Button
                        size="iconSm"
                        variant="ghost"
                        class="text-muted-foreground hover:text-foreground h-7 w-7"
                        title="Transfer image"
                      >
                        <MoreHorizontal class="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" class="w-48">
                      <DropdownMenuLabel
                        class="text-muted-foreground text-xs font-semibold"
                      >
                        Transfer Image
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        class="cursor-pointer gap-2 text-xs"
                        @click="
                          handleSendToUpscaler(item.imageUrl, item.filename)
                        "
                      >
                        <Scaling class="h-3.5 w-3.5 text-blue-400" />
                        <span>Send to Upscaler</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        class="cursor-pointer gap-2 text-xs"
                        @click="handleSendToRmbg(item.imageUrl, item.filename)"
                      >
                        <WandSparkles class="h-3.5 w-3.5 text-pink-400" />
                        <span>Send to RMBG</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        class="cursor-pointer gap-2 text-xs"
                        @click="
                          handleSendToFaceDetailer(item.imageUrl, item.filename)
                        "
                      >
                        <ScanFace class="h-3.5 w-3.5 text-emerald-400" />
                        <span>Send to Face Detailer</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button
                        size="iconSm"
                        variant="ghost"
                        class="text-muted-foreground hover:text-foreground h-7 w-7"
                        @click="downloadHistoryImage(item)"
                      >
                        <Download class="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Download PNG</TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button
                        size="iconSm"
                        variant="ghost"
                        class="text-muted-foreground hover:text-destructive h-7 w-7"
                        @click="historyStore.removeHistory(item.id)"
                      >
                        <Trash2 class="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Delete from history</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SheetContent>
  </Sheet>

  <!-- Fullscreen Image Inspector Lightbox -->
  <ImageLightboxModal
    :open="inspectingItem !== null"
    :src="inspectingItem?.imageUrl"
    :title="inspectingItem?.filename"
    :workflow-state="inspectingItem?.workflowState"
    @update:open="(open) => !open && (inspectingItem = null)"
  >
    <template #actions>
      <Button
        v-if="inspectingItem"
        size="sm"
        class="h-7 gap-1.5 text-xs font-semibold shadow-2xs"
        @click="
          applyHistorySettings(inspectingItem);
          inspectingItem = null;
        "
      >
        <RotateCcw class="h-3 w-3" />
        <span>Reuse Settings</span>
      </Button>

      <!-- Lightbox Quick Transfer Dropdown -->
      <DropdownMenu v-if="inspectingItem">
        <DropdownMenuTrigger as-child>
          <Button
            size="iconSm"
            variant="ghost"
            class="h-8 w-8 text-white/80 hover:bg-white/10 hover:text-white"
            title="Transfer Image"
          >
            <MoreHorizontal class="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-48">
          <DropdownMenuLabel
            class="text-muted-foreground text-xs font-semibold"
          >
            Transfer Image
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            class="cursor-pointer gap-2 text-xs"
            @click="
              handleSendToUpscaler(
                inspectingItem.imageUrl,
                inspectingItem.filename
              )
            "
          >
            <Scaling class="h-3.5 w-3.5 text-blue-400" />
            <span>Send to Upscaler</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            class="cursor-pointer gap-2 text-xs"
            @click="
              handleSendToRmbg(inspectingItem.imageUrl, inspectingItem.filename)
            "
          >
            <WandSparkles class="h-3.5 w-3.5 text-pink-400" />
            <span>Send to RMBG</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            class="cursor-pointer gap-2 text-xs"
            @click="
              handleSendToFaceDetailer(
                inspectingItem.imageUrl,
                inspectingItem.filename
              )
            "
          >
            <ScanFace class="h-3.5 w-3.5 text-emerald-400" />
            <span>Send to Face Detailer</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        v-if="inspectingItem"
        size="iconSm"
        variant="ghost"
        class="h-8 w-8 text-white/80 hover:bg-white/10 hover:text-white"
        title="Download PNG"
        @click="downloadHistoryImage(inspectingItem)"
      >
        <Download class="h-4 w-4" />
      </Button>
    </template>
  </ImageLightboxModal>
</template>
