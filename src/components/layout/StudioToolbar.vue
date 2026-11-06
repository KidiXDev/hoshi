<script setup lang="ts">
import { Loader2, Trash2 } from '@lucide/vue';
import { Button } from '@/components/ui/button';

defineProps<{
  total: number;
  completed: number;
  processing: number;
  isSubmitting: boolean;
}>();
const emit = defineEmits<{ clear: [] }>();
</script>
<template>
  <header
    class="border-border bg-card/60 flex h-11 shrink-0 items-center justify-between border-b px-4 backdrop-blur-xs"
  >
    <!-- Left: Branding & Connection Status -->
    <div class="flex items-center gap-2.5"><slot name="identity" /></div>
    <!-- Right: Batch Stats & Quick Actions -->
    <div class="flex items-center gap-2">
      <div
        v-if="total > 0"
        class="bg-secondary/60 text-muted-foreground flex items-center gap-2 rounded-lg px-2.5 py-1 font-mono text-xs"
      >
        <span><strong class="text-foreground">{{ total }}</strong> total</span>
        <span class="text-muted-foreground/40">•</span>
        <span
          ><strong class="text-emerald-400">{{ completed }}</strong> done</span
        >
        <span v-if="processing > 0" class="text-muted-foreground/40">•</span>
        <span
          v-if="processing > 0"
          class="text-primary flex items-center gap-1"
        >
          <Loader2 class="h-3 w-3 animate-spin" />
          {{ processing }} active
        </span>
      </div>

      <div v-if="total > 0" class="bg-border h-4 w-px" />

      <Button
        v-if="total > 0"
        variant="outline"
        size="sm"
        class="h-7 text-xs"
        :disabled="isSubmitting || processing > 0"
        @click="emit('clear')"
      >
        <Trash2 class="mr-1 h-3.5 w-3.5" />
        Clear All
      </Button>

      <slot name="action" />
    </div>
  </header>
</template>
