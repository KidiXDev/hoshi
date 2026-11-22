<script setup lang="ts">
import { computed, onMounted } from 'vue';
import {
  ClipboardCopy,
  Dices,
  Eraser,
  Lock,
  LockOpen,
  Plus,
  Replace,
  Shirt,
  Undo2
} from '@lucide/vue';
import { toast } from 'vue-sonner';
import CharacterDatasetMissing from '@/components/character-helper/CharacterDatasetMissing.vue';
import CharacterFieldInput from '@/components/character-helper/CharacterFieldInput.vue';
import CharacterRatingSelect from '@/components/character-helper/CharacterRatingSelect.vue';
import PageLayout from '@/components/layout/PageLayout.vue';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  NumberField,
  NumberFieldContent,
  NumberFieldDecrement,
  NumberFieldIncrement,
  NumberFieldInput
} from '@/components/ui/number-field';
import { Switch } from '@/components/ui/switch';
import {
  CHARACTER_FIELD,
  type CharacterField,
  type CharacterSuggestion
} from '@/services/characterData';
import {
  MAX_DICE_COUNT,
  useCharacterHelperStore
} from '@/stores/characterHelperStore';

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

const store = useCharacterHelperStore();

const groups = computed(() => {
  const out = new Map<string, CharacterField[]>();
  for (const field of store.fieldDefs) {
    if (field.id === CHARACTER_FIELD) continue;
    out.set(field.group, [...(out.get(field.group) ?? []), field]);
  }
  return [...out];
});

const characterName = computed(() =>
  store.character.replace(/_\([^()]*\)$/u, '').replaceAll('_', ' ')
);
const characterSeries = computed(() =>
  (store.fields[CHARACTER_FIELD] ?? [])
    .slice(1)
    .map((tag) => tag.replaceAll('_', ' '))
    .join(' · ')
);

function pickCharacter(item: CharacterSuggestion) {
  if (item.kind === 'character') store.setCharacter(item.tag, item.series);
}

async function copyPrompt() {
  if (!store.prompt) return;
  try {
    await navigator.clipboard.writeText(store.prompt);
    toast.success('Prompt copied');
  } catch {
    toast.error('Failed to copy to clipboard');
  }
}

onMounted(() => store.run(store.load));
</script>

<template>
  <PageLayout
    title="Character Helper"
    subtitle="Build a character prompt from Danbooru tag statistics"
    content-class="overflow-y-auto p-4"
  >
    <template #icon>
      <Dices class="size-4" />
    </template>
    <template #actions>
      <CharacterRatingSelect />
      <div class="flex items-center gap-2">
        <Switch id="character-spaces" v-model="store.spaces" />
        <Label for="character-spaces" class="text-xs">Spaces</Label>
      </div>
      <div class="flex items-center gap-2">
        <Switch id="character-escape" v-model="store.escape" />
        <Label for="character-escape" class="text-xs">Escape brackets</Label>
      </div>
    </template>

    <CharacterDatasetMissing
      v-if="store.datasetInstalled === false"
      class="mx-auto mt-8 max-w-md"
    />
    <div v-else class="grid gap-4 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
      <aside class="flex flex-col gap-3 self-start lg:sticky lg:top-0">
        <section
          class="border-border bg-card flex flex-col gap-3 rounded-xl border p-3.5 shadow-2xs"
        >
          <div>
            <p
              class="truncate text-base font-semibold capitalize"
              :class="{ 'text-muted-foreground': !store.character }"
            >
              {{ characterName || 'No character' }}
            </p>
            <p class="text-muted-foreground truncate text-xs capitalize">
              {{ characterSeries || '—' }}
            </p>
          </div>

          <div class="flex items-start gap-1.5">
            <CharacterFieldInput
              :field="CHARACTER_FIELD"
              :model-value="store.fields[CHARACTER_FIELD] ?? []"
              placeholder="Search a character..."
              @update:model-value="store.setField(CHARACTER_FIELD, $event)"
              @pick="pickCharacter"
            />
            <Button
              variant="outline"
              size="icon"
              class="size-8 shrink-0"
              :aria-pressed="store.isLocked(CHARACTER_FIELD)"
              :title="
                store.isLocked(CHARACTER_FIELD) ? 'Unlock field' : 'Lock field'
              "
              @click="store.toggleLock(CHARACTER_FIELD)"
            >
              <Lock v-if="store.isLocked(CHARACTER_FIELD)" class="size-3.5" />
              <LockOpen v-else class="size-3.5" />
            </Button>
          </div>

          <button
            type="button"
            class="border-border bg-muted/40 hover:border-primary/40 min-h-24 rounded-md border p-2.5 text-left font-mono text-xs wrap-break-word whitespace-pre-wrap transition-colors"
            title="Click to copy"
            @click="copyPrompt"
          >
            <span v-if="store.prompt" class="select-text">{{
              store.prompt
            }}</span>
            <span v-else class="text-muted-foreground"
              >Pick a character, then Usual look or Roll</span
            >
          </button>

          <div class="grid grid-cols-3 gap-2">
            <Button
              size="sm"
              :disabled="store.busy"
              @click="store.run(() => store.roll())"
            >
              <Dices class="size-3.5" /> Roll
            </Button>
            <Button
              size="sm"
              variant="outline"
              :disabled="store.busy || !store.character"
              @click="store.run(store.usualLook)"
            >
              <Shirt class="size-3.5" /> Usual look
            </Button>
            <Button
              size="sm"
              variant="outline"
              :disabled="!store.prompt"
              @click="copyPrompt"
            >
              <ClipboardCopy class="size-3.5" /> Copy
            </Button>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <Button
              size="sm"
              variant="secondary"
              :disabled="!store.prompt"
              @click="store.sendToPrompt('append')"
            >
              <Plus class="size-3.5" /> Append to prompt
            </Button>
            <Button
              size="sm"
              variant="secondary"
              :disabled="!store.prompt"
              @click="store.sendToPrompt('replace')"
            >
              <Replace class="size-3.5" /> Replace prompt
            </Button>
          </div>

          <div class="flex flex-col gap-1.5">
            <Label class="text-xs">Must include</Label>
            <CharacterFieldInput
              v-model="store.mustInclude"
              field=""
              placeholder="Tags every roll keeps..."
            />
          </div>

          <div class="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              :disabled="!store.history.length"
              @click="store.undo"
            >
              <Undo2 class="size-3.5" /> Undo
            </Button>
            <Button size="sm" variant="ghost" @click="store.clearUnlocked">
              <Eraser class="size-3.5" /> Clear unlocked
            </Button>
          </div>
        </section>
      </aside>

      <div class="flex min-w-0 flex-col gap-4">
        <section v-for="[group, defs] in groups" :key="group">
          <h2
            class="text-primary mb-2 text-xs font-bold tracking-wider uppercase"
          >
            {{ group }}
          </h2>
          <div class="grid gap-3 xl:grid-cols-2">
            <div
              v-for="field in defs"
              :key="field.id"
              class="border-border bg-card flex flex-col gap-2 rounded-xl border p-3 shadow-2xs"
            >
              <div class="flex items-baseline justify-between gap-2">
                <span class="text-sm font-semibold capitalize">{{
                  field.label
                }}</span>
                <span class="text-muted-foreground truncate text-xs">{{
                  FIELD_HINTS[field.id]
                }}</span>
              </div>
              <CharacterFieldInput
                :field="field.id"
                :model-value="store.fields[field.id] ?? []"
                @update:model-value="store.setField(field.id, $event)"
              />
              <div class="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  class="h-7 gap-1 text-xs"
                  :aria-pressed="store.isLocked(field.id)"
                  @click="store.toggleLock(field.id)"
                >
                  <Lock v-if="store.isLocked(field.id)" class="size-3" />
                  <LockOpen v-else class="size-3" />
                  {{ store.isLocked(field.id) ? 'Locked' : 'Lock' }}
                </Button>
                <NumberField
                  v-model="store.counts[field.id]"
                  :min="0"
                  :max="MAX_DICE_COUNT"
                  class="w-24"
                  :aria-label="`Dice count for ${field.label}`"
                >
                  <NumberFieldContent>
                    <NumberFieldDecrement class="p-1.5" />
                    <NumberFieldInput class="h-7 text-xs" />
                    <NumberFieldIncrement class="p-1.5" />
                  </NumberFieldContent>
                </NumberField>
                <Button
                  variant="outline"
                  size="sm"
                  class="ml-auto h-7 gap-1 text-xs"
                  :disabled="store.busy"
                  @click="store.run(() => store.roll([field.id]))"
                >
                  <Dices class="size-3" /> Roll
                </Button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </PageLayout>
</template>
