<script lang="ts">
export interface SwitchOption<T extends string | number = string> {
  value: T;
  label: string;
}
</script>

<script setup lang="ts" generic="T extends string | number">
defineProps<{
  options: SwitchOption<T>[];
}>();

const model = defineModel<T>({ required: true });
</script>

<template>
  <div
    class="border-border/80 bg-secondary/60 inline-flex items-center rounded-lg border p-0.5 text-xs"
    role="group"
  >
    <button
      v-for="option in options"
      :key="String(option.value)"
      type="button"
      class="rounded-md px-2 py-1 text-xs font-medium transition-colors"
      :class="
        model === option.value
          ? 'bg-primary text-primary-foreground shadow-xs'
          : 'text-muted-foreground hover:text-foreground'
      "
      :aria-pressed="model === option.value"
      @click="model = option.value"
    >
      {{ option.label }}
    </button>
  </div>
</template>

