<script setup lang="ts">
import { Filter, RotateCcw } from '@lucide/vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';

withDefaults(
  defineProps<{
    /** Number of non-default filters; shown as a badge and enables Reset. */
    count: number;
    label?: string;
    /** Lay out slot content in a 2-column grid instead of a single column. */
    columns?: 1 | 2;
    triggerClass?: string;
    contentClass?: string;
  }>(),
  { label: 'Filters', columns: 1 }
);
const emit = defineEmits<{ reset: [] }>();
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="h-9 cursor-pointer gap-1.5 px-3 text-xs"
        :class="[
          triggerClass,
          { 'bg-primary/10 text-primary border-primary/30': count > 0 }
        ]"
      >
        <Filter class="h-3.5 w-3.5" />
        <span>{{ label }}</span>
        <Badge
          v-if="count > 0"
          variant="default"
          class="h-4 min-w-4 rounded-full px-1 text-xs font-semibold"
        >
          {{ count }}
        </Badge>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" class="w-80 p-3" :class="contentClass">
      <div class="flex flex-col gap-3">
        <div
          :class="
            columns === 2 ? 'grid grid-cols-2 gap-2' : 'flex flex-col gap-2'
          "
        >
          <slot />
        </div>
        <Button
          v-if="count > 0"
          type="button"
          variant="ghost"
          size="sm"
          class="text-muted-foreground hover:text-foreground h-7 cursor-pointer gap-1 self-end px-2 text-xs"
          @click="emit('reset')"
        >
          <RotateCcw class="h-3 w-3" />
          <span>Reset {{ label.toLowerCase() }}</span>
        </Button>
      </div>
    </PopoverContent>
  </Popover>
</template>
