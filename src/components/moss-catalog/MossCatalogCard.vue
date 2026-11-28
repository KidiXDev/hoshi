<script setup lang="ts">
import { computed, ref } from 'vue';
import { Copy, Info, Palette, Sparkles, User } from '@lucide/vue';
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
import { mossThumbnailUrl } from '@/services/mossCatalog';
import type { MossCatalogEntry } from '@/types/mossCatalog';

const props = defineProps<{
  entry: MossCatalogEntry;
  categoryLabel?: string;
}>();

const emit = defineEmits<{
  select: [entry: MossCatalogEntry];
  copy: [entry: MossCatalogEntry];
  use: [entry: MossCatalogEntry];
}>();

const imageLoaded = ref(false);
const imageError = ref(false);

const isStyle = computed(() => props.entry.kind === 'style');
const subtitle = computed(() =>
  isStyle.value ? props.categoryLabel || 'Art Style' : props.entry.copyright
);
const formattedCount = computed(() => {
  const count = props.entry.sourceCount;
  if (!count) return '';
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return `${count}`;
});
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <div
        class="group border-border/70 bg-card/60 hover:bg-card/90 hover:border-primary/50 relative flex cursor-pointer flex-col overflow-hidden rounded-xl border text-left transition-colors duration-200 select-none"
        @click="emit('select', entry)"
      >
        <div class="bg-muted/20 relative aspect-3/4 w-full overflow-hidden">
          <div
            v-if="!imageLoaded && !imageError"
            class="bg-muted/40 absolute inset-0 animate-pulse"
          />
          <img
            v-if="!imageError"
            :src="mossThumbnailUrl(entry)"
            :alt="entry.name"
            loading="lazy"
            class="h-full w-full object-cover object-center transition-opacity duration-300"
            :class="imageLoaded ? 'opacity-100' : 'opacity-0'"
            @load="imageLoaded = true"
            @error="imageError = true"
          />
          <div
            v-else
            class="text-muted-foreground bg-muted/10 flex h-full w-full flex-col items-center justify-center gap-2 p-4"
          >
            <Palette v-if="isStyle" class="h-10 w-10 opacity-30" />
            <User v-else class="h-10 w-10 opacity-30" />
            <span class="text-xs opacity-50">No preview</span>
          </div>

          <Badge
            v-if="formattedCount"
            variant="outline"
            class="bg-background/80 text-foreground border-border/60 pointer-events-none absolute top-2 right-2 h-5 px-1.5 text-xs shadow-xs backdrop-blur-md"
          >
            {{ formattedCount }}
          </Badge>

          <div
            class="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-linear-to-t from-black/90 via-black/50 to-transparent p-2.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
          >
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  size="sm"
                  variant="secondary"
                  class="bg-background/90 hover:bg-primary hover:text-primary-foreground h-8 w-8 cursor-pointer rounded-lg p-0 shadow-md backdrop-blur-md"
                  @click.stop="emit('copy', entry)"
                >
                  <Copy class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top"><p>Copy Prompt</p></TooltipContent>
            </Tooltip>
            <Button
              size="sm"
              variant="default"
              class="h-8 cursor-pointer gap-1.5 rounded-lg px-2.5 text-xs font-medium shadow-md"
              @click.stop="emit('use', entry)"
            >
              <Sparkles class="h-3.5 w-3.5" />
              <span>Use Prompt</span>
            </Button>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  size="sm"
                  variant="secondary"
                  class="bg-background/90 hover:bg-accent h-8 w-8 cursor-pointer rounded-lg p-0 shadow-md backdrop-blur-md"
                  @click.stop="emit('select', entry)"
                >
                  <Info class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top"><p>View Details</p></TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div class="flex flex-col gap-1 p-3">
          <h3
            class="text-foreground truncate text-sm leading-tight font-semibold"
            :title="entry.name"
          >
            {{ entry.name }}
          </h3>
          <span
            class="text-muted-foreground truncate text-xs"
            :title="subtitle"
          >
            {{ subtitle }}
          </span>
        </div>
      </div>
    </ContextMenuTrigger>
    <ContextMenuContent class="w-52">
      <ContextMenuItem @select="emit('select', entry)">
        <Info /> View Details
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem @select="emit('copy', entry)">
        <Copy /> Copy Prompt
      </ContextMenuItem>
      <ContextMenuItem @select="emit('use', entry)">
        <Sparkles /> Append to Workflow
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
</template>
