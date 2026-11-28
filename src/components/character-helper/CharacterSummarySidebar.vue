<script setup lang="ts">
import { computed, onUnmounted, shallowRef } from 'vue';
import {
  ArrowUpRight,
  BookmarkPlus,
  BookOpen,
  Check,
  ClipboardCopy,
  Dices,
  Image as ImageIcon,
  Lock,
  LockOpen,
  Plus,
  Replace,
  Shirt,
  User
} from '@lucide/vue';
import { toast } from 'vue-sonner';
import CharacterFieldInput from '@/components/character-helper/CharacterFieldInput.vue';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  CHARACTER_FIELD,
  type CharacterSuggestion
} from '@/services/characterData';
import { useCharacterHelperStore } from '@/stores/characterHelperStore';

const emit = defineEmits<{
  saveToLibrary: [];
  openWiki: [tag: string];
  openBooru: [tag: string];
  sendAndOpenWorkflow: [];
}>();

const store = useCharacterHelperStore();
const copied = shallowRef(false);
let copyTimer: ReturnType<typeof setTimeout> | undefined;

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
    copied.value = true;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copied.value = false;
    }, 1500);
    toast.success('Prompt copied');
  } catch {
    toast.error('Failed to copy to clipboard');
  }
}

onUnmounted(() => {
  clearTimeout(copyTimer);
});
</script>

<template>
  <aside
    class="border-border bg-card flex h-full flex-col overflow-hidden rounded-xl border shadow-2xs"
  >
    <!-- Pinned Top: Character Identity & Primary Roll Controls -->
    <div class="border-border/80 flex shrink-0 flex-col gap-3 border-b p-3.5">
      <div class="flex items-center justify-between gap-2.5">
        <div class="flex min-w-0 items-center gap-2.5">
          <div
            class="flex size-9 shrink-0 items-center justify-center rounded-lg border transition-colors"
            :class="
              store.character
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'border-border bg-muted/60 text-muted-foreground'
            "
          >
            <User class="size-4" />
          </div>
          <div class="min-w-0">
            <p
              class="truncate text-sm font-semibold capitalize"
              :class="{ 'text-muted-foreground': !store.character }"
            >
              {{ characterName || 'No character selected' }}
            </p>
            <p class="text-muted-foreground truncate text-xs capitalize">
              {{ characterSeries || 'Search or roll a character below' }}
            </p>
          </div>
        </div>

        <div v-if="store.character" class="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="iconSm"
            class="text-muted-foreground hover:text-foreground h-7 w-7"
            title="Open character in Danbooru Wiki"
            @click="emit('openWiki', store.character)"
          >
            <BookOpen class="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="iconSm"
            class="text-muted-foreground hover:text-foreground h-7 w-7"
            title="Search character in Booru Gallery"
            @click="emit('openBooru', store.character)"
          >
            <ImageIcon class="size-3.5" />
          </Button>
        </div>
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
          :disabled="store.busy"
          title="Roll a random character"
          @click="store.run(() => store.roll([CHARACTER_FIELD]))"
        >
          <Dices class="size-3.5" />
        </Button>
        <Button
          :variant="store.isLocked(CHARACTER_FIELD) ? 'secondary' : 'outline'"
          size="icon"
          class="size-8 shrink-0"
          :class="
            store.isLocked(CHARACTER_FIELD) &&
            'border-primary/40 text-primary border'
          "
          :aria-pressed="store.isLocked(CHARACTER_FIELD)"
          :title="
            store.isLocked(CHARACTER_FIELD)
              ? 'Unlock character'
              : 'Lock character'
          "
          @click="store.toggleLock(CHARACTER_FIELD)"
        >
          <Lock v-if="store.isLocked(CHARACTER_FIELD)" class="size-3.5" />
          <LockOpen v-else class="size-3.5" />
        </Button>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <Button
          size="sm"
          class="h-8 text-xs font-semibold"
          :disabled="store.busy || store.unlockedIds.length === 0"
          @click="store.run(() => store.roll())"
        >
          <Dices class="size-3.5" /> Roll unlocked
        </Button>
        <Button
          size="sm"
          variant="outline"
          class="h-8 text-xs"
          :disabled="store.busy || !store.character"
          @click="store.run(store.usualLook)"
        >
          <Shirt class="size-3.5" /> Usual look
        </Button>
      </div>
    </div>

    <!-- Scrollable Middle: Live Prompt & Must-Include Constraints -->
    <div class="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-3.5">
      <div class="flex min-h-0 flex-1 flex-col gap-1.5">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span
              class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
            >
              Built Prompt
            </span>
            <span
              v-if="store.tags.length > 0"
              class="bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 font-mono text-xs leading-none"
            >
              {{ store.tags.length }} tag{{
                store.tags.length === 1 ? '' : 's'
              }}
            </span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            class="h-6 gap-1 px-2 text-xs"
            :disabled="!store.prompt"
            @click="copyPrompt"
          >
            <Check v-if="copied" class="size-3 text-emerald-400" />
            <ClipboardCopy v-else class="size-3" />
            {{ copied ? 'Copied' : 'Copy' }}
          </Button>
        </div>

        <button
          type="button"
          class="border-border bg-background/60 hover:border-primary/40 flex min-h-32 flex-1 items-start overflow-y-auto rounded-lg border p-3 text-left font-mono text-xs leading-relaxed wrap-break-word whitespace-pre-wrap transition-colors"
          title="Click to copy prompt"
          @click="copyPrompt"
        >
          <span v-if="store.prompt" class="select-text">{{
            store.prompt
          }}</span>
          <span v-else class="text-muted-foreground"
            >Pick a character, then click Usual look or Roll unlocked to build a
            prompt.</span
          >
        </button>
      </div>

      <div class="flex shrink-0 flex-col gap-1.5">
        <div class="flex items-baseline justify-between gap-2">
          <Label
            class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
          >
            Must Include
          </Label>
          <span class="text-muted-foreground text-xs">Kept on every roll</span>
        </div>
        <CharacterFieldInput
          v-model="store.mustInclude"
          field=""
          placeholder="Add required tags..."
        />
      </div>
    </div>

    <!-- Pinned Footer: Workflow & Library Export Dock -->
    <div
      class="border-border bg-muted/25 flex shrink-0 flex-col gap-2 border-t p-3"
    >
      <Button
        size="sm"
        class="h-8 w-full gap-1.5 text-xs font-semibold"
        :disabled="!store.prompt"
        title="Append tags to positive prompt and open Workflow Generator"
        @click="emit('sendAndOpenWorkflow')"
      >
        <ArrowUpRight class="size-3.5" />
        Send &amp; Open Workflow
      </Button>

      <div class="grid grid-cols-3 gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          class="h-7 gap-1 px-2 text-xs"
          :disabled="!store.prompt"
          title="Append tags to positive prompt without leaving"
          @click="store.sendToPrompt('append')"
        >
          <Plus class="size-3" /> Append
        </Button>
        <Button
          size="sm"
          variant="secondary"
          class="h-7 gap-1 px-2 text-xs"
          :disabled="!store.prompt"
          title="Replace positive prompt without leaving"
          @click="store.sendToPrompt('replace')"
        >
          <Replace class="size-3" /> Replace
        </Button>
        <Button
          size="sm"
          variant="outline"
          class="h-7 gap-1 px-2 text-xs"
          :disabled="!store.prompt"
          title="Save this build to your Character Library"
          @click="emit('saveToLibrary')"
        >
          <BookmarkPlus class="size-3" /> Save
        </Button>
      </div>
    </div>
  </aside>
</template>
