<script setup lang="ts">
import { shallowRef, watch } from 'vue';
import { Loader2, User } from '@lucide/vue';
import { toast } from 'vue-sonner';
import TagAutocompleteField from '@/components/prompt/TagAutocompleteField.vue';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  CHARACTER_FIELD,
  formatCharacterTag,
  formatCharacterTags
} from '@/services/characterData';
import { useCharacterHelperStore } from '@/stores/characterHelperStore';
import { useLibraryStore } from '@/stores/libraryStore';
import type { CharacterData } from '@/types/library';

const open = defineModel<boolean>('open', { required: true });

const store = useCharacterHelperStore();
const libraryStore = useLibraryStore();

const name = shallowRef('');
const trigger = shallowRef('');
const series = shallowRef('');
const tagsText = shallowRef('');
const notes = shallowRef('');
const saving = shallowRef(false);

function titleCase(raw: string): string {
  return raw
    .replace(/_\([^()]*\)$/u, '')
    .split(/[_\s]+/u)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function hydrateFromStore() {
  const format = { spaces: store.spaces, escape: store.escape };
  const charTags = store.fields[CHARACTER_FIELD] ?? [];
  const primary = charTags[0] ?? '';
  const seriesRaw = charTags.slice(1).join(', ');

  name.value = primary ? titleCase(primary) : '';
  trigger.value = primary ? formatCharacterTag(primary, format) : '';
  series.value = seriesRaw ? titleCase(seriesRaw) : '';

  const nonCharacterFields = Object.fromEntries(
    Object.entries(store.fields).filter(([key]) => key !== CHARACTER_FIELD)
  );
  const additionalTags = formatCharacterTags(nonCharacterFields, format);
  tagsText.value = additionalTags.join(', ');
  notes.value = '';
}

watch(open, (isOpen) => {
  if (isOpen) hydrateFromStore();
});

async function handleSave() {
  const trimmedName = name.value.trim();
  const trimmedTrigger = trigger.value.trim();
  if (!trimmedName || !trimmedTrigger) return;

  saving.value = true;
  try {
    const data: CharacterData = {
      series: series.value.trim() || undefined,
      trigger: trimmedTrigger,
      tags: tagsText.value
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      source: 'local',
      notes: notes.value.trim() || undefined
    };

    await libraryStore.saveItem<CharacterData>({
      category: 'characters',
      name: trimmedName,
      data
    });
    toast.success(`Saved "${trimmedName}" to Character Library`);
    open.value = false;
  } catch (error) {
    toast.error('Failed to save to Character Library', {
      description: error instanceof Error ? error.message : String(error)
    });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      class="border-border bg-card flex max-h-[85vh] w-full max-w-lg flex-col gap-0 overflow-hidden p-0"
    >
      <DialogHeader
        class="border-border bg-background/50 shrink-0 flex-row items-center justify-between border-b px-5 py-4"
      >
        <div class="space-y-0.5">
          <DialogTitle class="flex items-center gap-2 text-sm font-bold">
            <User class="text-primary size-4" />
            Save to Character Library
          </DialogTitle>
          <DialogDescription class="text-xs">
            Store this character build as a reusable Library preset.
          </DialogDescription>
        </div>
        <DialogCloseButton class="-my-1.5" />
      </DialogHeader>

      <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
        <div class="grid grid-cols-2 gap-3">
          <div class="flex flex-col gap-1.5">
            <Label class="text-xs font-semibold">
              Name <span class="text-destructive">*</span>
            </Label>
            <Input
              v-model="name"
              placeholder="e.g. Hatsune Miku"
              class="text-xs"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label class="text-xs font-semibold">Series</Label>
            <Input
              v-model="series"
              placeholder="e.g. Vocaloid"
              class="text-xs"
            />
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label class="text-xs font-semibold">
            Trigger Tag <span class="text-destructive">*</span>
          </Label>
          <Input
            v-model="trigger"
            placeholder="e.g. hatsune miku"
            class="font-mono text-xs"
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <Label class="text-xs font-semibold">Additional Tags</Label>
          <TagAutocompleteField
            v-model="tagsText"
            multiline
            rows="4"
            placeholder="Hair, eyes, outfit, pose, background..."
            class="bg-background font-mono text-xs"
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <Label class="text-xs font-semibold">Notes</Label>
          <Textarea
            v-model="notes"
            rows="3"
            placeholder="Optional notes on outfits, personality, or LoRA pairings..."
            class="bg-background text-xs"
          />
        </div>
      </div>

      <DialogFooter
        class="border-border bg-muted/30 flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3"
      >
        <Button
          variant="outline"
          size="sm"
          class="text-xs"
          @click="open = false"
        >
          Cancel
        </Button>
        <Button
          size="sm"
          class="gap-1.5 text-xs font-semibold"
          :disabled="!name.trim() || !trigger.trim() || saving"
          @click="handleSave"
        >
          <Loader2 v-if="saving" class="size-3.5 animate-spin" />
          Save Character
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
