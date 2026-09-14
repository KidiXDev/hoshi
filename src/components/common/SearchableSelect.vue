<script setup lang="ts">
import { ChevronsUpDown, LayoutGrid } from '@lucide/vue';
import { ref, watch, type HTMLAttributes } from 'vue';
import { Button } from '@/components/ui/button';
import {
  Combobox,
  ComboboxAnchor,
  ComboboxTrigger,
  ComboboxInput,
  ComboboxList,
  ComboboxGroup,
  ComboboxItem,
  ComboboxEmpty
} from '@/components/ui/combobox';
import { cn } from '@/lib/utils';
import { ComfyApi } from '../../services/comfyApi';
import { useLauncherStore } from '../../stores/launcherStore';
import ModelGridSelectorDialog from './ModelGridSelectorDialog.vue';

type PreviewCategory = Parameters<typeof ComfyApi.getModelPreviewUrl>[1];

const model = defineModel<string>({ default: '' });
const props = withDefaults(
  defineProps<{
    options: string[];
    placeholder?: string;
    disabled?: boolean;
    class?: HTMLAttributes['class'];
    /** Model folder category — enables hover previews + grid browse button. */
    previewCategory?: PreviewCategory;
    gridTitle?: string;
  }>(),
  { placeholder: 'Select...' }
);

const launcherStore = useLauncherStore();
const isGridOpen = ref(false);
const isOpen = ref(false);
const hovered = ref<{ name: string; url: string; x: number; y: number } | null>(
  null
);
watch(isOpen, (open) => !open && hidePreview());
const failedPreviews = ref(new Set<string>());

// 3:4 portrait, matches the grid dialog cards
const PREVIEW_W = 180;
const PREVIEW_H = 240;

// Items linger through the close animation; ignore hovers once the list is closing.
function showPreview(name: string, event: PointerEvent) {
  hidePreview();
  if (!isOpen.value || !props.previewCategory || failedPreviews.value.has(name))
    return;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const fitsRight = rect.right + 8 + PREVIEW_W <= window.innerWidth;
  hovered.value = {
    name,
    url: ComfyApi.getModelPreviewUrl(
      launcherStore.config.serverUrl,
      props.previewCategory,
      name,
      300
    ),
    x: fitsRight ? rect.right + 8 : rect.left - 8 - PREVIEW_W,
    y: Math.min(rect.top, window.innerHeight - PREVIEW_H - 8)
  };
}

function hidePreview() {
  hovered.value = null;
}
</script>

<template>
  <div
    :class="cn('flex w-full min-w-0 flex-1 items-center gap-1.5', $props.class)"
  >
    <Combobox
      v-model="model"
      v-model:open="isOpen"
      :disabled="disabled"
      class="w-full min-w-0 flex-1"
    >
      <ComboboxAnchor class="w-full">
        <ComboboxTrigger class="w-full" as-child>
          <Button
            variant="outline"
            :disabled="disabled"
            class="w-full justify-between font-mono text-xs"
            :aria-label="placeholder"
          >
            <span class="truncate">{{ model || placeholder }}</span>
            <ChevronsUpDown class="ml-2 size-3.5 shrink-0 opacity-50" />
          </Button>
        </ComboboxTrigger>
      </ComboboxAnchor>
      <ComboboxList class="w-(--reka-combobox-trigger-width)">
        <ComboboxInput placeholder="Search..." :display-value="() => ''" />
        <ComboboxEmpty class="p-2 text-xs">No matches</ComboboxEmpty>
        <ComboboxGroup
          class="max-h-40 overflow-y-auto"
          @pointerleave="hidePreview"
        >
          <ComboboxItem
            v-for="option in options"
            :key="option"
            :value="option"
            class="font-mono text-xs"
            @pointerenter="showPreview(option, $event)"
            >{{ option }}</ComboboxItem
          >
        </ComboboxGroup>
      </ComboboxList>
    </Combobox>

    <template v-if="previewCategory">
      <Button
        type="button"
        size="icon"
        variant="outline"
        :disabled="disabled"
        title="Browse in grid view"
        class="border-border bg-secondary text-foreground hover:bg-accent h-8 w-8 shrink-0"
        @click="isGridOpen = true"
      >
        <LayoutGrid class="h-3.5 w-3.5" />
      </Button>

      <ModelGridSelectorDialog
        v-model:open="isGridOpen"
        :title="gridTitle ?? placeholder"
        :category="previewCategory"
        :models="options"
        :selected-model="model"
        @select="(m) => (model = m)"
      />

      <!-- Floating hover preview -->
      <Teleport defer to="#app-content">
        <div
          v-if="hovered"
          class="border-border bg-popover pointer-events-none fixed z-60 overflow-hidden rounded-md border shadow-lg"
          :style="{
            left: `${hovered.x}px`,
            top: `${hovered.y}px`,
            width: `${PREVIEW_W}px`,
            height: `${PREVIEW_H}px`
          }"
        >
          <img
            :key="hovered.name"
            :src="hovered.url"
            :alt="hovered.name"
            decoding="async"
            class="h-full w-full object-cover"
            @error="
              failedPreviews.add(hovered.name);
              hidePreview();
            "
          />
        </div>
      </Teleport>
    </template>
  </div>
</template>
