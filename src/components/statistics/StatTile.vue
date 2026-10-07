<script setup lang="ts">
defineProps<{ label: string; value: string; hint?: string }>();
</script>

<template>
  <div
    class="border-border/80 bg-card/80 flex min-w-0 flex-col gap-1 rounded-xl border p-4 shadow-xs"
  >
    <span class="text-muted-foreground text-xs">{{ label }}</span>
    <span class="text-foreground text-2xl font-semibold">{{ value }}</span>
    <span v-if="hint" class="text-muted-foreground truncate text-xs">
      {{ hint }}
    </span>
  </div>
</template>
