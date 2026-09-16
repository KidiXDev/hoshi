<script setup lang="ts">
import { onUnmounted, provide } from 'vue';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import {
  confirmDialogKey,
  createConfirmDialog
} from '@/composables/useConfirmDialog';

const { open, options, confirm, finish } = createConfirmDialog();

provide(confirmDialogKey, confirm);
onUnmounted(() => finish(false));
</script>

<template>
  <slot />

  <AlertDialog :open="open" @update:open="(value) => !value && finish(false)">
    <AlertDialogContent class="border-border bg-card sm:max-w-md">
      <AlertDialogHeader>
        <AlertDialogTitle
          class="text-foreground text-base font-bold wrap-anywhere"
        >
          {{ options.title }}
        </AlertDialogTitle>
        <AlertDialogDescription
          class="text-muted-foreground text-xs leading-relaxed wrap-anywhere"
        >
          {{ options.description }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter class="gap-2 sm:gap-2">
        <AlertDialogCancel class="h-8 text-xs">
          {{ options.cancelLabel ?? 'Cancel' }}
        </AlertDialogCancel>
        <AlertDialogAction
          class="bg-destructive text-destructive-foreground hover:bg-destructive/90 h-8 text-xs font-semibold"
          @click.capture="finish(true)"
        >
          {{ options.confirmLabel ?? 'Delete' }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
