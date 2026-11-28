<script setup lang="ts">
import { computed, type Component } from 'vue';
import {
  Dices,
  Eraser,
  Image as ImageIcon,
  Layers,
  Lock,
  LockOpen,
  Shirt,
  Sparkles,
  User
} from '@lucide/vue';
import CharacterFieldCard from '@/components/character-helper/CharacterFieldCard.vue';
import { Button } from '@/components/ui/button';
import type { CharacterField } from '@/services/characterData';
import { useCharacterHelperStore } from '@/stores/characterHelperStore';

const GROUP_ICONS: Record<string, Component> = {
  who: User,
  looks: Sparkles,
  clothes: Shirt,
  scene: ImageIcon
};

const props = defineProps<{
  group: string;
  fields: CharacterField[];
  hints: Record<string, string>;
}>();

const store = useCharacterHelperStore();

const groupIcon = computed(() => GROUP_ICONS[props.group] ?? Layers);
const groupIds = computed(() => props.fields.map((f) => f.id));

const lockedCount = computed(
  () => groupIds.value.filter((id) => store.isLocked(id)).length
);
const allLocked = computed(
  () => groupIds.value.length > 0 && lockedCount.value === groupIds.value.length
);
const totalTags = computed(() =>
  groupIds.value.reduce((sum, id) => sum + (store.fields[id]?.length ?? 0), 0)
);
const hasClearableTags = computed(() =>
  groupIds.value.some(
    (id) => !store.isLocked(id) && (store.fields[id]?.length ?? 0) > 0
  )
);

function toggleGroupLock() {
  store.setGroupLock(groupIds.value, !allLocked.value);
}

function updateCount(id: string, value: number) {
  store.counts[id] = value;
}
</script>

<template>
  <section class="flex flex-col gap-3">
    <div
      class="border-border/60 flex flex-wrap items-center justify-between gap-2 border-b pb-2"
    >
      <div class="flex items-center gap-2">
        <div
          class="border-primary/25 bg-primary/10 text-primary flex size-6 items-center justify-center rounded-md border"
        >
          <component :is="groupIcon" class="size-3.5 shrink-0" />
        </div>
        <h2 class="text-foreground text-xs font-bold tracking-wider uppercase">
          {{ props.group }}
        </h2>
        <span
          v-if="totalTags > 0"
          class="bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 font-mono text-xs leading-none"
        >
          {{ totalTags }}
        </span>
        <span
          v-if="lockedCount > 0"
          class="border-primary/30 bg-primary/10 text-primary rounded-md border px-1.5 py-0.5 font-mono text-xs leading-none"
        >
          {{ lockedCount }}/{{ groupIds.length }} locked
        </span>
      </div>

      <div class="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          class="text-muted-foreground hover:text-foreground h-7 gap-1 px-2 text-xs"
          :title="
            allLocked
              ? `Unlock all ${props.group} fields`
              : `Lock all ${props.group} fields`
          "
          @click="toggleGroupLock"
        >
          <LockOpen v-if="allLocked" class="size-3" />
          <Lock v-else class="size-3" />
          {{ allLocked ? 'Unlock' : 'Lock' }}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="text-muted-foreground hover:text-destructive h-7 gap-1 px-2 text-xs"
          :disabled="!hasClearableTags"
          :title="`Clear unlocked ${props.group} fields`"
          @click="store.clearGroup(groupIds)"
        >
          <Eraser class="size-3" />
          Clear
        </Button>
        <Button
          variant="outline"
          size="sm"
          class="h-7 gap-1 px-2.5 text-xs"
          :disabled="store.busy || allLocked"
          :title="`Roll unlocked ${props.group} fields`"
          @click="store.run(() => store.rollGroup(groupIds))"
        >
          <Dices class="size-3" />
          Roll group
        </Button>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3">
      <CharacterFieldCard
        v-for="field in props.fields"
        :key="field.id"
        :field="field"
        :tags="store.fields[field.id] ?? []"
        :locked="store.isLocked(field.id)"
        :count="store.counts[field.id] ?? field.count"
        :hint="props.hints[field.id]"
        :busy="store.busy"
        @update:tags="store.setField(field.id, $event)"
        @update:count="updateCount(field.id, $event)"
        @toggle-lock="store.toggleLock(field.id)"
        @clear="store.clearField(field.id)"
        @roll="store.run(() => store.roll([field.id]))"
      />
    </div>
  </section>
</template>
