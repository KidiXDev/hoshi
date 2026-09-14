<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { X } from '@lucide/vue';
import { DialogClose } from 'reka-ui';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const props = defineProps<{
  class?: HTMLAttributes['class'];
}>();
</script>

<template>
  <DialogClose as-child>
    <Button
      size="iconSm"
      variant="ghost"
      aria-label="Close"
      :class="
        cn(
          'text-muted-foreground hover:text-foreground shrink-0 cursor-pointer',
          props.class
        )
      "
    >
      <X class="h-4 w-4" />
    </Button>
  </DialogClose>
</template>
