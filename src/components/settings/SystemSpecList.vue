<script setup lang="ts">
defineProps<{ rows: [label: string, value: string][] }>();
</script>

<template>
  <dl class="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-6 gap-y-2 text-xs">
    <template v-for="[label, value] in rows" :key="label">
      <dt class="text-muted-foreground">{{ label }}</dt>
      <dd class="text-foreground min-w-0 font-mono break-all">
        {{ value || '—' }}
      </dd>
    </template>
  </dl>
</template>
