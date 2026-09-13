<script setup lang="ts">
/**
 * Page frame shared by the Civitai model detail and the Model Manager detail:
 * a header (back button, breadcrumb, actions) above a 7/5 two-column grid.
 */
import { ArrowLeft } from '@lucide/vue';
import { Button } from '@/components/ui/button';

withDefaults(defineProps<{ backLabel?: string }>(), { backLabel: 'Back' });
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <div
    class="bg-background relative flex h-full flex-col overflow-hidden select-none"
  >
    <header
      class="border-border/80 bg-card/70 flex h-14 shrink-0 items-center justify-between gap-3 border-b px-6 backdrop-blur-md"
    >
      <div class="flex min-w-0 items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          class="h-8 shrink-0 cursor-pointer gap-1.5 text-xs font-medium"
          @click="emit('close')"
        >
          <ArrowLeft class="h-3.5 w-3.5" />
          <span>{{ backLabel }}</span>
        </Button>
        <div class="bg-border/80 h-4 w-px shrink-0" />
        <div class="flex min-w-0 items-center gap-2 truncate text-xs">
          <slot name="breadcrumb" />
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <slot name="actions" />
      </div>
    </header>

    <div class="flex-1 overflow-y-auto p-6 lg:p-8">
      <div class="mx-auto grid w-full grid-cols-1 gap-8 lg:grid-cols-12">
        <div class="flex flex-col gap-4 lg:col-span-7">
          <slot name="stage" />
        </div>
        <div class="flex flex-col gap-5 lg:col-span-5">
          <slot name="sidebar" />
        </div>
      </div>
    </div>

    <slot />
  </div>
</template>
