<script setup lang="ts">
import { computed, useId } from 'vue';
import { Dices } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { randomSeed } from '@/utils/seed';

const seed = defineModel<number>({ required: true });
const props = withDefaults(
  defineProps<{ label?: string; disabled?: boolean }>(),
  { label: 'Generation Seed', disabled: false }
);
const checkboxId = useId();
const randomizeSeed = computed({
  get: () => seed.value === -1,
  set: (randomize: boolean) => {
    if (randomize) seed.value = -1;
    else rollSeed();
  }
});

function rollSeed() {
  seed.value = randomSeed();
}

function setSeedValue(value: string | number) {
  const number = Number(value);
  if (Number.isFinite(number)) seed.value = number;
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <div class="flex items-center justify-between">
      <span
        class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
      >
        {{ props.label }}
      </span>
      <div class="flex items-center gap-1.5">
        <Checkbox
          :id="checkboxId"
          v-model="randomizeSeed"
          :disabled="props.disabled"
        />
        <Label
          :for="checkboxId"
          class="text-muted-foreground hover:text-foreground cursor-pointer text-xs font-medium select-none"
          :class="{ 'pointer-events-none opacity-50': props.disabled }"
        >
          Randomize
        </Label>
      </div>
    </div>

    <div class="flex items-center gap-1.5">
      <Input
        :model-value="seed"
        :disabled="props.disabled"
        type="number"
        class="w-full font-mono text-xs"
        placeholder="Enter seed number (-1 for random)..."
        @update:model-value="setSeedValue"
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        class="border-border bg-secondary text-foreground hover:bg-accent h-8 w-8 shrink-0"
        title="Roll New Random Seed"
        @click="rollSeed()"
        :disabled="props.disabled"
      >
        <Dices
          class="text-muted-foreground hover:text-foreground h-3.5 w-3.5"
        />
      </Button>
    </div>
  </div>
</template>
