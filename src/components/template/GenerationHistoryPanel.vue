<script setup lang="ts">
import { ref } from 'vue';
import { dragHistoryImage } from '@/services/imageGallery';
import {
  History,
  Images,
  Maximize2,
  Scaling,
  ScanFace,
  Trash2,
  Wand2,
  WandSparkles,
  X
} from '@lucide/vue';
import ImageLightboxModal from '@/components/common/ImageLightboxModal.vue';
import { useImageTransfer } from '@/composables/useImageTransfer';
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
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { useComfyStore } from '../../stores/comfyStore';
import { useHistoryStore } from '../../stores/historyStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import type { HistoryItem, WorkflowState } from '../../types/workflow';

const historyStore = useHistoryStore();
const comfyStore = useComfyStore();
const workflowStore = useWorkflowStore();
const { sendImageTo } = useImageTransfer();

const isLightboxOpen = ref(false);
const lightboxSrc = ref('');
const lightboxTitle = ref('');
const lightboxState = ref<WorkflowState>();

function selectImage(item: HistoryItem) {
  comfyStore.lastGeneratedImage = {
    url: item.imageUrl,
    filename: item.filename,
    subfolder: item.subfolder,
    type: item.type,
    promptId: item.promptId,
    workflowState: item.workflowState,
    durationMs: item.durationMs ?? 0
  };
}

function applySettings(item: HistoryItem) {
  workflowStore.applyWorkflowState(item.workflowState);
  selectImage(item);
}

function openLightbox(item: HistoryItem) {
  lightboxSrc.value = item.imageUrl;
  lightboxTitle.value = item.filename || 'Generated Image';
  lightboxState.value = item.workflowState;
  isLightboxOpen.value = true;
}

function isSelected(item: HistoryItem) {
  const selected = comfyStore.lastGeneratedImage;
  return (
    selected?.promptId === item.promptId && selected.filename === item.filename
  );
}

function formatTime(timestamp: number) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
</script>

<template>
  <div class="flex h-full min-h-0 w-full flex-col overflow-hidden select-none">
    <!-- Header Row -->
    <div class="flex h-8 shrink-0 items-center justify-between gap-2 pb-2">
      <div class="flex items-center gap-1.5 truncate">
        <History class="text-primary h-3.5 w-3.5 shrink-0" />
        <span
          class="text-foreground text-xs font-bold tracking-wider uppercase"
        >
          History
        </span>
        <Badge
          v-if="historyStore.items.length > 0"
          variant="secondary"
          class="h-4.5 px-1.5 font-mono text-xs font-bold"
        >
          {{ historyStore.items.length }}
        </Badge>
      </div>

      <div class="flex shrink-0 items-center gap-1">
        <Tooltip v-if="historyStore.items.length > 0">
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="iconXs"
              class="hover:text-destructive text-muted-foreground h-6 w-6 cursor-pointer"
              @click="historyStore.clearHistory()"
            >
              <Trash2 class="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Clear session history</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="iconXs"
              class="text-muted-foreground hover:text-foreground h-6 w-6 cursor-pointer"
              @click="historyStore.isPanelOpen = false"
            >
              <X class="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Hide history panel</TooltipContent>
        </Tooltip>
      </div>
    </div>

    <!-- Main Images Gallery Content -->
    <div
      v-if="historyStore.items.length === 0"
      class="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center"
    >
      <div class="bg-secondary rounded-full p-3">
        <Images class="h-6 w-6 opacity-40" />
      </div>
      <p class="text-foreground text-xs font-semibold">No history yet</p>
      <p class="text-muted-foreground text-xs">
        Generated images will appear here
      </p>
    </div>

    <div v-else class="min-h-0 flex-1 overflow-y-auto pr-1">
      <div class="flex flex-col gap-2 p-0.5">
        <ContextMenu v-for="item in historyStore.items" :key="item.id">
          <ContextMenuTrigger as-child>
            <div
              :draggable="!!item.imageUrl"
              @dragstart="dragHistoryImage($event, item)"
              class="group relative aspect-3/4 cursor-pointer overflow-hidden rounded-lg border bg-black/40 transition-all duration-150"
              :class="
                isSelected(item)
                  ? 'border-primary ring-primary/40 shadow-sm ring-2'
                  : 'border-border/60 hover:border-primary/50 hover:shadow-xs'
              "
              @click="selectImage(item)"
            >
              <img
                v-if="item.imageUrl"
                draggable="false"
                :src="item.imageUrl"
                :alt="item.filename || 'history image'"
                class="h-full w-full object-cover"
                loading="lazy"
              />

              <!-- Hover Overlay -->
              <div
                class="absolute inset-0 flex flex-col justify-between bg-linear-to-t from-black/85 via-black/20 to-transparent p-1.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
              >
                <!-- Top Action Icons -->
                <div class="flex items-center justify-end gap-1">
                  <Button
                    variant="outline"
                    size="iconXs"
                    class="h-6 w-6 border-white/20 bg-black/60 text-white backdrop-blur-xs hover:bg-black/80 hover:text-white"
                    title="View fullscreen"
                    @click.stop="openLightbox(item)"
                  >
                    <Maximize2 class="h-3 w-3" />
                  </Button>
                  <Button
                    variant="outline"
                    size="iconXs"
                    class="hover:bg-destructive h-6 w-6 border-white/20 bg-black/60 text-white backdrop-blur-xs hover:text-white"
                    title="Delete image from history"
                    @click.stop="historyStore.removeHistory(item.id)"
                  >
                    <Trash2 class="h-3 w-3" />
                  </Button>
                </div>

                <!-- Bottom Row: Timestamp and Apply Button -->
                <div class="flex items-center justify-between gap-1">
                  <span class="truncate font-mono text-xs text-white/80">
                    {{ formatTime(item.timestamp) }}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    class="h-6 cursor-pointer gap-1 px-1.5 text-xs font-medium shadow-xs"
                    title="Apply settings to workflow"
                    @click.stop="applySettings(item)"
                  >
                    <Wand2 class="h-3 w-3" />
                    <span>Apply</span>
                  </Button>
                </div>
              </div>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent class="w-52">
            <ContextMenuItem @select="openLightbox(item)">
              <Maximize2 /> View Fullscreen
            </ContextMenuItem>
            <ContextMenuItem @select="applySettings(item)">
              <Wand2 /> Apply Settings
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              @select="sendImageTo('upscaler', item.imageUrl, item.filename)"
            >
              <Scaling /> Send to Upscaler
            </ContextMenuItem>
            <ContextMenuItem
              @select="
                sendImageTo('remove-background', item.imageUrl, item.filename)
              "
            >
              <WandSparkles /> Send to RMBG
            </ContextMenuItem>
            <ContextMenuItem
              @select="
                sendImageTo('face-detailer', item.imageUrl, item.filename)
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
      </div>
    </div>

    <!-- Lightbox Modal -->
    <ImageLightboxModal
      :open="isLightboxOpen"
      :src="lightboxSrc"
      :title="lightboxTitle"
      :workflow-state="lightboxState"
      @update:open="(val) => (isLightboxOpen = val)"
    />
  </div>
</template>
