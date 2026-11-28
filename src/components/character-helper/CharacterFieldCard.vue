<script setup lang="ts">
import { Dices, Eraser, Lock, LockOpen } from '@lucide/vue';
import CharacterFieldInput from '@/components/character-helper/CharacterFieldInput.vue';
import { Button } from '@/components/ui/button';
import {
  NumberField,
  NumberFieldContent,
  NumberFieldDecrement,
  NumberFieldIncrement,
  NumberFieldInput
} from '@/components/ui/number-field';
import type { CharacterField } from '@/services/characterData';
import { MAX_DICE_COUNT } from '@/stores/characterHelperStore';

const props = defineProps<{
  field: CharacterField;
  tags: string[];
  locked: boolean;
  count: number;
  hint?: string;
  busy: boolean;
}>();

const emit = defineEmits<{
  'update:tags': [tags: string[]];
  'update:count': [count: number];
  toggleLock: [];
  clear: [];
  roll: [];
}>();
</script>

<template>
  <div
    class="flex flex-col gap-2.5 rounded-xl border p-3 shadow-2xs transition-colors"
    :class="
      props.locked
        ? 'border-primary/40 bg-primary/5 ring-primary/15 ring-1'
        : 'border-border bg-card hover:border-primary/30'
    "
  >
    <div class="flex items-center justify-between gap-2">
      <div class="flex min-w-0 items-center gap-1.5">
        <span class="truncate text-sm font-semibold capitalize">{{
          props.field.label
        }}</span>
        <span
          v-if="props.tags.length > 0"
          class="bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 font-mono text-xs leading-none"
        >
          {{ props.tags.length }}
        </span>
        <Lock
          v-if="props.locked"
          class="text-primary size-3 shrink-0"
          aria-hidden="true"
        />
      </div>
      <span
        v-if="props.hint"
        class="text-muted-foreground truncate text-xs"
        :title="props.hint"
      >
        {{ props.hint }}
      </span>
    </div>

    <CharacterFieldInput
      :field="props.field.id"
      :model-value="props.tags"
      @update:model-value="emit('update:tags', $event)"
    />

    <div class="border-border/50 flex items-center gap-1.5 border-t pt-2">
      <Button
        :variant="props.locked ? 'secondary' : 'outline'"
        size="sm"
        class="h-7 gap-1 px-2 text-xs"
        :class="props.locked && 'border-primary/40 text-primary border'"
        :aria-pressed="props.locked"
        :title="props.locked ? 'Unlock field' : 'Lock field'"
        @click="emit('toggleLock')"
      >
        <Lock v-if="props.locked" class="size-3" />
        <LockOpen v-else class="size-3" />
        {{ props.locked ? 'Locked' : 'Lock' }}
      </Button>

      <NumberField
        :model-value="props.count"
        :min="0"
        :max="MAX_DICE_COUNT"
        class="w-22"
        :title="`Tags to roll (default: ${props.field.count})`"
        :aria-label="`Dice count for ${props.field.label}`"
        @update:model-value="emit('update:count', $event)"
      >
        <NumberFieldContent>
          <NumberFieldDecrement class="p-1.5" />
          <NumberFieldInput
            class="h-7 text-xs"
            :class="
              props.count !== props.field.count && 'text-primary font-semibold'
            "
          />
          <NumberFieldIncrement class="p-1.5" />
        </NumberFieldContent>
      </NumberField>

      <div class="ml-auto flex items-center gap-1">
        <Button
          v-if="props.tags.length > 0"
          variant="ghost"
          size="iconSm"
          class="text-muted-foreground hover:text-destructive h-7 w-7"
          title="Clear field"
          @click="emit('clear')"
        >
          <Eraser class="size-3.5" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          class="h-7 gap-1 px-2.5 text-xs"
          :disabled="props.busy"
          title="Roll this field"
          @click="emit('roll')"
        >
          <Dices class="size-3" /> Roll
        </Button>
      </div>
    </div>
  </div>
</template>
