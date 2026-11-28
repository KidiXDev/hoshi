<script setup lang="ts">
import { computed, type Component } from 'vue';
import {
  Eraser,
  Image as ImageIcon,
  LayoutGrid,
  Layers,
  Lock,
  LockOpen,
  Redo2,
  RotateCcw,
  Shield,
  Shirt,
  Sparkles,
  Undo2,
  User
} from '@lucide/vue';
import { Button } from '@/components/ui/button';
import {
  useCharacterHelperStore,
  type LockPreset
} from '@/stores/characterHelperStore';

export interface CharacterGroupTab {
  id: string;
  label: string;
  tagCount: number;
}

const GROUP_ICONS: Record<string, Component> = {
  all: LayoutGrid,
  who: User,
  looks: Sparkles,
  clothes: Shirt,
  scene: ImageIcon
};

const LOCK_PRESETS: Array<{
  id: LockPreset;
  label: string;
  title: string;
  icon: typeof Lock;
}> = [
  {
    id: 'identity',
    label: 'Identity',
    title: 'Lock character, subject, hair, eyes, and body',
    icon: Shield
  },
  {
    id: 'outfit',
    label: 'Outfit',
    title: 'Lock identity plus clothing and accessories',
    icon: Shirt
  },
  {
    id: 'all',
    label: 'All',
    title: 'Lock every field',
    icon: Lock
  },
  {
    id: 'none',
    label: 'None',
    title: 'Unlock every field',
    icon: LockOpen
  }
];

const activeGroup = defineModel<string>('activeGroup', { required: true });
const props = defineProps<{
  groups: CharacterGroupTab[];
}>();

const store = useCharacterHelperStore();

const totalGroupTags = computed(() =>
  props.groups.reduce((sum, g) => sum + g.tagCount, 0)
);
const hasClearableUnlocked = computed(() =>
  store.unlockedIds.some((id) => (store.fields[id]?.length ?? 0) > 0)
);

function iconFor(id: string): Component {
  return GROUP_ICONS[id] ?? Layers;
}
</script>

<template>
  <div
    class="border-border bg-card/30 flex shrink-0 flex-wrap items-center justify-between gap-2.5 border-b px-5 py-2"
  >
    <!-- Group filter tabs -->
    <div
      role="tablist"
      aria-label="Field groups"
      class="border-border bg-muted/60 flex shrink-0 items-center gap-0.5 rounded-lg border p-0.5"
    >
      <button
        type="button"
        role="tab"
        :aria-selected="activeGroup === 'all'"
        class="flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-all"
        :class="
          activeGroup === 'all'
            ? 'bg-background text-foreground shadow-xs'
            : 'text-muted-foreground hover:text-foreground'
        "
        @click="activeGroup = 'all'"
      >
        <component
          :is="iconFor('all')"
          class="size-3.5"
          :class="activeGroup === 'all' && 'text-primary'"
        />
        <span>All</span>
        <span
          v-if="totalGroupTags > 0"
          class="text-muted-foreground font-mono text-xs"
        >
          {{ totalGroupTags }}
        </span>
      </button>

      <button
        v-for="group in props.groups"
        :key="group.id"
        type="button"
        role="tab"
        :aria-selected="activeGroup === group.id"
        class="flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold capitalize transition-all"
        :class="
          activeGroup === group.id
            ? 'bg-background text-foreground shadow-xs'
            : 'text-muted-foreground hover:text-foreground'
        "
        @click="activeGroup = group.id"
      >
        <component
          :is="iconFor(group.id)"
          class="size-3.5"
          :class="activeGroup === group.id && 'text-primary'"
        />
        <span>{{ group.label }}</span>
        <span
          v-if="group.tagCount > 0"
          class="text-muted-foreground font-mono text-xs"
        >
          {{ group.tagCount }}
        </span>
      </button>
    </div>

    <!-- Lock presets + history utilities -->
    <div class="flex flex-wrap items-center gap-2">
      <div class="flex items-center gap-1.5">
        <span
          class="text-muted-foreground hidden text-xs font-medium xl:inline"
        >
          Lock:
        </span>
        <div
          class="border-border bg-muted/60 flex items-center gap-0.5 rounded-lg border p-0.5"
          title="Quick lock presets"
        >
          <button
            v-for="preset in LOCK_PRESETS"
            :key="preset.id"
            type="button"
            class="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors"
            :class="
              store.activeLockPreset === preset.id
                ? 'bg-background text-primary shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            "
            :title="preset.title"
            @click="store.applyLockPreset(preset.id)"
          >
            <component :is="preset.icon" class="size-3 shrink-0" />
            <span>{{ preset.label }}</span>
          </button>
        </div>
        <span
          class="text-muted-foreground hidden font-mono text-xs 2xl:inline"
          title="Locked fields"
        >
          {{ store.locks.length }}/{{ store.fieldIds.length }}
        </span>
      </div>

      <div class="bg-border h-4 w-px shrink-0" />

      <div class="flex items-center gap-1">
        <Button
          size="iconSm"
          variant="ghost"
          class="text-muted-foreground hover:text-foreground h-7 w-7"
          :disabled="!store.canUndo"
          title="Undo (Ctrl+Z)"
          @click="store.undo"
        >
          <Undo2 class="size-3.5" />
        </Button>
        <Button
          size="iconSm"
          variant="ghost"
          class="text-muted-foreground hover:text-foreground h-7 w-7"
          :disabled="!store.canRedo"
          title="Redo (Ctrl+Y)"
          @click="store.redo"
        >
          <Redo2 class="size-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          class="text-muted-foreground hover:text-destructive h-7 gap-1 px-2 text-xs"
          :disabled="!hasClearableUnlocked"
          title="Clear all unlocked fields"
          @click="store.clearUnlocked"
        >
          <Eraser class="size-3.5" />
          <span class="hidden sm:inline">Clear</span>
        </Button>
        <Button
          v-if="store.hasCustomCounts"
          size="sm"
          variant="ghost"
          class="text-muted-foreground hover:text-foreground h-7 gap-1 px-2 text-xs"
          title="Reset all dice counts to defaults"
          @click="store.resetCounts"
        >
          <RotateCcw class="size-3.5" />
          <span class="hidden sm:inline">Reset dice</span>
        </Button>
      </div>
    </div>
  </div>
</template>
