<script setup lang="ts">
defineProps<{ label: string }>();
</script>

<template>
  <div class="flex flex-col gap-1">
    <span class="text-muted-foreground text-xs">{{ label }}</span>
    <slot />
  </div>
</template>
