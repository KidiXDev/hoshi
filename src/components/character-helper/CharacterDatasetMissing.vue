<script setup lang="ts">
import { Database } from '@lucide/vue';
import { useRouter } from 'vue-router';
import { Button } from '@/components/ui/button';

const router = useRouter();
</script>

<template>
  <div
    class="border-border bg-muted/30 flex flex-col items-center gap-2 rounded-lg border border-dashed p-4 text-center"
  >
    <Database class="text-muted-foreground size-5" />
    <p class="text-sm font-medium">No character dataset yet</p>
    <p class="text-muted-foreground text-xs">
      Build it once in Settings. It downloads Danbooru data and keeps a small
      database.
    </p>
    <Button
      size="sm"
      class="mt-1 h-8 text-xs"
      @click="router.push({ path: '/settings', query: { tab: 'character' } })"
    >
      Open Character Helper settings
    </Button>
  </div>
</template>
