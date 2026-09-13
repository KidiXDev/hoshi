<script setup lang="ts">
/** Skeleton mirroring the detail layout (stage, thumbnail strip, sidebar cards). */
import ModelDetailShell from './ModelDetailShell.vue';
import { Skeleton } from '@/components/ui/skeleton';

withDefaults(
  defineProps<{ backLabel?: string; title?: string; category?: string }>(),
  { backLabel: 'Back', title: '', category: '' }
);
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <ModelDetailShell :back-label="backLabel" @close="emit('close')">
    <template #breadcrumb>
      <template v-if="title">
        <span class="text-muted-foreground shrink-0">Models</span>
        <span class="text-muted-foreground">/</span>
        <span v-if="category" class="text-muted-foreground shrink-0">
          {{ category }}
        </span>
        <span v-if="category" class="text-muted-foreground">/</span>
        <span class="text-foreground truncate font-semibold">{{ title }}</span>
      </template>
      <Skeleton v-else class="h-4 w-48" />
    </template>
    <template #actions>
      <Skeleton class="h-8 w-28 rounded-md" />
      <Skeleton class="h-8 w-24 rounded-md" />
    </template>

    <template #stage>
      <Skeleton class="aspect-3/4 max-h-150 w-full rounded-2xl" />
      <div class="flex gap-2">
        <Skeleton
          v-for="n in 6"
          :key="n"
          class="h-16 w-16 shrink-0 rounded-lg"
        />
      </div>
      <Skeleton class="h-40 w-full rounded-xl" />
    </template>

    <template #sidebar>
      <div class="flex flex-col gap-2.5">
        <div class="flex gap-2">
          <Skeleton class="h-5 w-20 rounded-md" />
          <Skeleton class="h-5 w-24 rounded-md" />
        </div>
        <Skeleton class="h-7 w-3/4 rounded-lg" />
        <Skeleton class="h-4 w-1/2 rounded" />
      </div>
      <Skeleton class="h-36 w-full rounded-xl" />
      <Skeleton class="h-28 w-full rounded-xl" />
      <Skeleton class="h-40 w-full rounded-xl" />
    </template>
  </ModelDetailShell>
</template>
