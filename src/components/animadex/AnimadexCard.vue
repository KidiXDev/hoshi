<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  Check,
  Copy,
  Info,
  Layers,
  Palette,
  Sparkles,
  User
} from '@lucide/vue';
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
import type {
  AnimaDexArtist,
  AnimaDexCharacter,
  AnimaDexCopyright
} from '@/types/animadex';

const props = defineProps<{
  item: AnimaDexCharacter | AnimaDexArtist | AnimaDexCopyright;
  type: 'character' | 'artist' | 'copyright';
}>();

const emit = defineEmits<{
  (
    e: 'select',
    item: AnimaDexCharacter | AnimaDexArtist | AnimaDexCopyright
  ): void;
  (e: 'copy-trigger', trigger: string): void;
  (e: 'send-to-workflow', trigger: string): void;
}>();

const imageLoaded = ref(false);
const imageError = ref(false);
const justCopied = ref(false);

const isCharacter = computed(() => props.type === 'character');
const isArtist = computed(() => props.type === 'artist');

const character = computed(() =>
  isCharacter.value ? (props.item as AnimaDexCharacter) : null
);

const artist = computed(() =>
  isArtist.value ? (props.item as AnimaDexArtist) : null
);

const formattedCount = computed(() => {
  const count = props.item.count;
  if (!count && count !== 0) return '';
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return `${count}`;
});

const formattedScore = computed(() => {
  if (artist.value && typeof artist.value.score === 'number') {
    return `${Math.round(artist.value.score * 100)}%`;
  }
  return null;
});

const triggerText = computed(() => {
  if (character.value?.trigger) return character.value.trigger;
  if (artist.value?.trigger) return artist.value.trigger;
  return '';
});

const hasLoras = computed(() => {
  return (
    character.value?.loras &&
    Array.isArray(character.value.loras) &&
    character.value.loras.length > 0
  );
});

function handleCopyTrigger(e: Event) {
  e.stopPropagation();
  if (!triggerText.value) return;
  emit('copy-trigger', triggerText.value);
  justCopied.value = true;
  setTimeout(() => {
    justCopied.value = false;
  }, 1500);
}

function handleSendToWorkflow(e: Event) {
  e.stopPropagation();
  if (!triggerText.value) return;
  emit('send-to-workflow', triggerText.value);
}

function handleSelect() {
  emit('select', props.item);
}
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <div
        class="group border-border/70 bg-card/60 hover:bg-card/90 hover:border-primary/50 relative flex cursor-pointer flex-col overflow-hidden rounded-xl border text-left transition-colors duration-200 select-none [content-visibility:auto]"
        @click="handleSelect"
      >
        <!-- Aspect ratio thumbnail container -->
        <div class="bg-muted/20 relative aspect-3/4 w-full overflow-hidden">
          <!-- Loading Skeleton placeholder -->
          <div
            v-if="!imageLoaded && !imageError && item.thumb_url"
            class="bg-muted/40 absolute inset-0 animate-pulse"
          />

          <!-- Thumbnail image -->
          <img
            v-if="item.thumb_url && !imageError"
            :src="item.thumb_url"
            :alt="item.name"
            loading="lazy"
            class="h-full w-full object-cover object-center transition-opacity duration-300"
            :class="{ 'opacity-0': !imageLoaded, 'opacity-100': imageLoaded }"
            @load="imageLoaded = true"
            @error="imageError = true"
          />

          <!-- Fallback when no image or error -->
          <div
            v-if="!item.thumb_url || imageError"
            class="text-muted-foreground bg-muted/10 flex h-full w-full flex-col items-center justify-center gap-2 p-4"
          >
            <User v-if="isCharacter" class="h-10 w-10 opacity-30" />
            <Palette v-else-if="isArtist" class="h-10 w-10 opacity-30" />
            <Layers v-else class="h-10 w-10 opacity-30" />
            <span class="text-xs opacity-50">No preview</span>
          </div>

          <!-- Top Badges Overlay -->
          <div
            class="pointer-events-none absolute top-2 right-2 left-2 flex items-center justify-between gap-1"
          >
            <div class="flex items-center gap-1">
              <!-- LoRA Available badge -->
              <Badge
                v-if="hasLoras"
                variant="default"
                class="h-5 bg-purple-600/90 px-1.5 text-xs font-semibold text-white shadow-xs backdrop-blur-md"
              >
                LoRA
              </Badge>

              <!-- Artist Classifier Score badge -->
              <Badge
                v-if="formattedScore"
                variant="secondary"
                class="h-5 border border-emerald-500/30 bg-emerald-500/20 px-1.5 text-xs font-medium text-emerald-300 shadow-xs backdrop-blur-md"
              >
                {{ formattedScore }}
              </Badge>
            </div>

            <!-- Post count badge -->
            <Badge
              v-if="formattedCount"
              variant="outline"
              class="bg-background/80 text-foreground border-border/60 h-5 px-1.5 text-xs shadow-xs backdrop-blur-md"
            >
              {{ formattedCount }}
            </Badge>
          </div>

          <!-- Quick Action Overlay on Hover -->
          <div
            class="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-linear-to-t from-black/90 via-black/50 to-transparent p-2.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
          >
            <Tooltip v-if="triggerText">
              <TooltipTrigger as-child>
                <Button
                  size="sm"
                  variant="secondary"
                  class="bg-background/90 hover:bg-primary hover:text-primary-foreground h-8 w-8 cursor-pointer rounded-lg p-0 shadow-md backdrop-blur-md"
                  @click="handleCopyTrigger"
                >
                  <Check v-if="justCopied" class="h-4 w-4 text-emerald-500" />
                  <Copy v-else class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>
                  {{ justCopied ? 'Copied Trigger!' : 'Copy Trigger Prompt' }}
                </p>
              </TooltipContent>
            </Tooltip>

            <Tooltip v-if="triggerText">
              <TooltipTrigger as-child>
                <Button
                  size="sm"
                  variant="default"
                  class="h-8 cursor-pointer gap-1.5 rounded-lg px-2.5 text-xs font-medium shadow-md"
                  @click="handleSendToWorkflow"
                >
                  <Sparkles class="h-3.5 w-3.5" />
                  <span>Use Prompt</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>Append Trigger to Workflow Prompt</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  size="sm"
                  variant="secondary"
                  class="bg-background/90 hover:bg-accent h-8 w-8 cursor-pointer rounded-lg p-0 shadow-md backdrop-blur-md"
                  @click.stop="handleSelect"
                >
                  <Info class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>View Details & Tags</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <!-- Card Description Footer -->
        <div class="flex flex-col gap-1 p-3">
          <h3
            class="text-foreground truncate text-sm leading-tight font-semibold"
            :title="item.name"
          >
            {{ item.name }}
          </h3>

          <div
            class="text-muted-foreground flex items-center justify-between gap-1 text-xs"
          >
            <span
              v-if="character"
              class="truncate hover:underline"
              :title="character.copyright_name || character.copyright"
            >
              {{ character.copyright_name || character.copyright }}
            </span>
            <span v-else-if="artist" class="truncate opacity-75">
              Artist Style
            </span>
            <span v-else class="truncate opacity-75"> Series Franchise </span>
          </div>
        </div>
      </div>
    </ContextMenuTrigger>
    <ContextMenuContent class="w-52">
      <ContextMenuItem @select="handleSelect">
        <Info /> View Details
      </ContextMenuItem>
      <template v-if="triggerText">
        <ContextMenuSeparator />
        <ContextMenuItem @select="handleCopyTrigger">
          <Copy /> Copy Trigger Prompt
        </ContextMenuItem>
        <ContextMenuItem @select="handleSendToWorkflow">
          <Sparkles /> Append to Workflow
        </ContextMenuItem>
      </template>
    </ContextMenuContent>
  </ContextMenu>
</template>
