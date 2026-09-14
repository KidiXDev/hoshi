<script setup lang="ts">
import type {
  DialogContentEmits,
  DialogContentProps,
  FocusOutsideEvent,
  PointerDownOutsideEvent
} from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { X } from '@lucide/vue';
import { reactiveOmit } from '@vueuse/core';
import {
  DialogClose,
  DialogContent,
  DialogPortal,
  injectDialogRootContext,
  useForwardPropsEmits
} from 'reka-ui';
import { cn } from '@/lib/utils';
import { useOverlayLayer } from '@/composables/useOverlayLayer';
import DialogOverlay from './DialogOverlay.vue';

defineOptions({
  inheritAttrs: false
});

const props = withDefaults(
  defineProps<
    DialogContentProps & {
      class?: HTMLAttributes['class'];
      showCloseButton?: boolean;
    }
  >(),
  {
    showCloseButton: false
  }
);
const emits = defineEmits<DialogContentEmits>();

const delegatedProps = reactiveOmit(props, 'class');

const forwarded = useForwardPropsEmits(delegatedProps, emits);
const { isTop: isTopOverlay, style: overlayStyle } = useOverlayLayer(
  injectDialogRootContext().open
);

function preventInactiveDismiss(event: Event) {
  if (!isTopOverlay.value) event.preventDefault();
}

function preventTitlebarDismiss(
  event: FocusOutsideEvent | PointerDownOutsideEvent
) {
  preventInactiveDismiss(event);
  if (event.defaultPrevented) return;
  const target = event.detail.originalEvent.target;
  if (
    target instanceof Node &&
    !document.querySelector('#app-content')?.contains(target)
  ) {
    event.preventDefault();
  }
}
</script>

<template>
  <DialogPortal defer to="#app-content">
    <DialogOverlay :style="overlayStyle" />
    <DialogContent
      data-slot="dialog-content"
      v-bind="{ ...$attrs, ...forwarded }"
      :style="overlayStyle"
      @interact-outside="preventTitlebarDismiss"
      @escape-key-down="preventInactiveDismiss"
      :class="
        cn(
          'bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 absolute top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg',
          props.class
        )
      "
    >
      <slot />

      <DialogClose
        v-if="showCloseButton"
        data-slot="dialog-close"
        class="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
      >
        <X />
        <span class="sr-only">Close</span>
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>
