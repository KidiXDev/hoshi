<script setup lang="ts">
import { useEventListener } from '@vueuse/core';
import { computed, onMounted, shallowRef } from 'vue';
import { useRouter } from 'vue-router';
import { Dices, Loader2, Settings } from '@lucide/vue';
import CharacterDatasetMissing from '@/components/character-helper/CharacterDatasetMissing.vue';
import CharacterFieldGroup from '@/components/character-helper/CharacterFieldGroup.vue';
import CharacterRatingSelect from '@/components/character-helper/CharacterRatingSelect.vue';
import CharacterSummarySidebar from '@/components/character-helper/CharacterSummarySidebar.vue';
import CharacterWorkspaceToolbar, {
  type CharacterGroupTab
} from '@/components/character-helper/CharacterWorkspaceToolbar.vue';
import SaveCharacterToLibraryDialog from '@/components/character-helper/SaveCharacterToLibraryDialog.vue';
import NoticeBanner from '@/components/layout/NoticeBanner.vue';
import PageLayout from '@/components/layout/PageLayout.vue';
import StudioLayout from '@/components/layout/StudioLayout.vue';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  CHARACTER_FIELD,
  rebuildPercent,
  type CharacterField
} from '@/services/characterData';
import { wikiPath } from '@/services/danbooruWiki';
import { useCharacterHelperStore } from '@/stores/characterHelperStore';

defineOptions({ name: 'CharacterHelperView' });

const FIELD_HINTS: Record<string, string> = {
  character: 'character and series',
  subject: 'who is in the picture',
  hair: 'colour, length, style',
  eyes: 'colour, pupils, eyebrows',
  body: 'ears, horns, tail, wings, build',
  outfit: 'whole-body clothing',
  top: 'shirts, jackets, sleeves, neckwear',
  bottom: 'skirts, trousers',
  legwear: 'legwear and footwear',
  accessories: 'headwear, jewellery, gloves, held items',
  expression: 'face',
  pose: 'posture, gestures, gaze',
  view: 'framing and camera angle',
  background: 'setting, lighting, props'
};

const router = useRouter();
const store = useCharacterHelperStore();
const saveDialogOpen = shallowRef(false);
const activeGroup = shallowRef('all');

const groups = computed(() => {
  const out = new Map<string, CharacterField[]>();
  for (const field of store.fieldDefs) {
    if (field.id === CHARACTER_FIELD) continue;
    out.set(field.group, [...(out.get(field.group) ?? []), field]);
  }
  return [...out];
});

const groupTabs = computed<CharacterGroupTab[]>(() =>
  groups.value.map(([id, defs]) => ({
    id,
    label: id,
    tagCount: defs.reduce(
      (sum, f) => sum + (store.fields[f.id]?.length ?? 0),
      0
    )
  }))
);

const visibleGroups = computed(() => {
  if (activeGroup.value === 'all') return groups.value;
  const matched = groups.value.filter(([group]) => group === activeGroup.value);
  return matched.length > 0 ? matched : groups.value;
});

const rebuildStatusText = computed(() => {
  const progress = store.rebuildProgress;
  if (!progress) return 'Rebuilding Character Helper dataset…';
  return `Rebuilding dataset (${rebuildPercent(progress)}%) · ${progress.label}`;
});

function openSettings() {
  void router.push({ path: '/settings', query: { tab: 'character' } });
}

function openWiki(tag: string) {
  void router.push(wikiPath(tag));
}

function openBooru(tag: string) {
  void router.push({ path: '/booru', query: { q: tag } });
}

function sendAndOpenWorkflow() {
  if (!store.prompt) return;
  store.sendToPrompt('append');
  void router.push('/workflow');
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  );
}

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  if (isEditableElement(event.target)) return;
  const key = event.key.toLowerCase();
  if (key === 'z' && !event.shiftKey && store.canUndo) {
    event.preventDefault();
    store.undo();
  } else if (
    (key === 'y' || (key === 'z' && event.shiftKey)) &&
    store.canRedo
  ) {
    event.preventDefault();
    store.redo();
  }
});

onMounted(() => store.run(store.load));
</script>

<template>
  <PageLayout
    title="Character Helper"
    subtitle="Build a character prompt from Danbooru tag statistics"
    header-class="bg-card/60 px-5 py-3"
    content-class="flex flex-col overflow-hidden p-0"
  >
    <template #icon>
      <Dices class="size-4" />
    </template>
    <template #actions>
      <CharacterRatingSelect />
      <div class="bg-border h-4 w-px shrink-0" />
      <div class="flex items-center gap-2">
        <Switch id="character-spaces" v-model="store.spaces" />
        <Label for="character-spaces" class="text-xs">Spaces</Label>
      </div>
      <div class="flex items-center gap-2">
        <Switch id="character-escape" v-model="store.escape" />
        <Label for="character-escape" class="text-xs">Escape brackets</Label>
      </div>
      <div class="bg-border h-4 w-px shrink-0" />
      <Button
        variant="outline"
        size="iconSm"
        class="h-8 w-8"
        title="Character Helper settings"
        @click="openSettings"
      >
        <Settings class="size-3.5" />
      </Button>
    </template>

    <template #below-header>
      <div v-if="store.rebuilding" class="border-border border-b px-5 py-2">
        <NoticeBanner tone="info">
          <span class="inline-flex items-center gap-2">
            <Loader2 class="size-3.5 shrink-0 animate-spin" />
            <span>{{ rebuildStatusText }}</span>
          </span>
          <template #actions>
            <Button
              size="sm"
              variant="ghost"
              class="h-7 shrink-0 text-xs"
              @click="openSettings"
            >
              View progress
            </Button>
          </template>
        </NoticeBanner>
      </div>

      <CharacterWorkspaceToolbar
        v-if="store.datasetInstalled === true"
        v-model:active-group="activeGroup"
        :groups="groupTabs"
      />
    </template>

    <!-- Loading skeleton -->
    <div
      v-if="store.datasetInstalled === null"
      class="grid min-h-0 flex-1 gap-3 overflow-hidden p-3 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]"
    >
      <Skeleton class="h-full rounded-xl" />
      <div class="grid content-start gap-3 xl:grid-cols-2">
        <Skeleton v-for="n in 8" :key="n" class="h-32 rounded-xl" />
      </div>
    </div>

    <div
      v-else-if="store.datasetInstalled === false"
      class="flex flex-1 items-center justify-center p-6"
    >
      <CharacterDatasetMissing class="w-full max-w-md" />
    </div>

    <StudioLayout
      v-else
      :sidebar-size="32"
      :sidebar-min-size="25"
      :sidebar-max-size="45"
      :preview-min-size="50"
    >
      <template #sidebar>
        <CharacterSummarySidebar
          @save-to-library="saveDialogOpen = true"
          @open-wiki="openWiki"
          @open-booru="openBooru"
          @send-and-open-workflow="sendAndOpenWorkflow"
        />
      </template>

      <div class="@container h-full overflow-y-auto pr-1.5 pb-4 pl-1">
        <div class="flex flex-col gap-6">
          <CharacterFieldGroup
            v-for="[group, defs] in visibleGroups"
            :key="group"
            :group="group"
            :fields="defs"
            :hints="FIELD_HINTS"
          />
        </div>
      </div>
    </StudioLayout>

    <SaveCharacterToLibraryDialog v-model:open="saveDialogOpen" />
  </PageLayout>
</template>
