<script setup lang="ts">
import { Skeleton } from '@/components/ui/skeleton';

withDefaults(
  defineProps<{
    mode?: 'groups' | 'article';
  }>(),
  {
    mode: 'groups'
  }
);
</script>

<template>
  <!-- Groups skeleton: 2-pane master-detail layout -->
  <div v-if="mode === 'groups'" class="flex h-full min-h-96 overflow-hidden">
    <!-- Left sidebar skeleton -->
    <div
      class="border-border/60 bg-card/20 hidden w-64 shrink-0 flex-col gap-2.5 border-r p-3 sm:flex sm:w-72"
    >
      <Skeleton class="h-7 w-full rounded-md" />
      <Skeleton class="h-7 w-full rounded-md" />
      <div class="mt-1 space-y-1.5">
        <Skeleton v-for="i in 10" :key="i" class="h-7 w-full rounded-md" />
      </div>
    </div>

    <!-- Right content skeleton -->
    <div class="flex flex-1 flex-col space-y-4 overflow-hidden p-5">
      <div
        class="border-border/50 flex items-center justify-between border-b pb-3"
      >
        <div class="flex items-center gap-2">
          <Skeleton class="h-5 w-20 rounded" />
          <Skeleton class="h-6 w-40 rounded" />
        </div>
        <Skeleton class="h-7 w-48 rounded-md" />
      </div>

      <div
        class="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
      >
        <Skeleton v-for="j in 25" :key="j" class="h-8 rounded-md" />
      </div>
    </div>
  </div>

  <!-- Article skeleton: Clean document layout -->
  <div v-else class="space-y-6">
    <!-- Document Header Skeleton -->
    <div class="border-border/50 space-y-3 border-b pb-4">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="space-y-2">
          <Skeleton class="h-7 w-52 rounded" />
          <div class="flex items-center gap-2">
            <Skeleton class="h-5 w-24 rounded" />
            <Skeleton class="h-4 w-32" />
          </div>
        </div>
        <div class="flex items-center gap-1.5">
          <Skeleton class="h-7 w-24 rounded-md" />
          <Skeleton class="h-7 w-24 rounded-md" />
          <Skeleton class="h-7 w-16 rounded-md" />
        </div>
      </div>
    </div>

    <!-- Document Content Skeleton -->
    <div class="space-y-4">
      <div class="space-y-2">
        <Skeleton class="h-4 w-full" />
        <Skeleton class="h-4 w-5/6" />
        <Skeleton class="h-4 w-4/6" />
      </div>

      <div class="space-y-2 pt-2">
        <Skeleton class="h-5 w-36 rounded" />
        <Skeleton class="h-4 w-full" />
        <Skeleton class="h-4 w-3/4" />
      </div>

      <!-- Illustrated list skeleton -->
      <div class="grid grid-cols-1 gap-2 pt-2 sm:grid-cols-2">
        <div
          v-for="p in 4"
          :key="p"
          class="border-border/50 flex items-center gap-3 rounded-lg border p-3"
        >
          <Skeleton class="size-16 shrink-0 rounded-md" />
          <div class="flex-1 space-y-1.5">
            <Skeleton class="h-4 w-28" />
            <Skeleton class="h-3 w-full" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
