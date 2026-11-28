<script setup lang="ts">
defineProps<{
  label: string;
  value: string;
  hint?: string;
  badge?: string;
  badgeTone?: 'positive' | 'neutral';
}>();
</script>

<template>
  <div
    class="border-border/80 bg-card/80 hover:border-border flex min-w-0 flex-col justify-between gap-2 rounded-xl border p-4 shadow-xs transition-colors"
  >
    <div class="flex items-center justify-between gap-2">
      <span class="text-muted-foreground truncate text-xs font-medium">
        {{ label }}
      </span>
      <div
        v-if="$slots.icon"
        class="border-border/70 bg-secondary/70 text-primary flex size-7 shrink-0 items-center justify-center rounded-lg border"
      >
        <slot name="icon" />
      </div>
    </div>

    <div class="flex items-baseline justify-between gap-2">
      <span class="text-foreground truncate text-2xl font-bold tabular-nums">
        {{ value }}
      </span>
      <span
        v-if="badge"
        class="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums"
        :class="
          badgeTone === 'positive'
            ? 'bg-emerald-500/15 text-emerald-400'
            : 'bg-primary/15 text-primary'
        "
      >
        {{ badge }}
      </span>
    </div>

    <span v-if="hint" class="text-muted-foreground truncate text-xs">
      {{ hint }}
    </span>
  </div>
</template>
