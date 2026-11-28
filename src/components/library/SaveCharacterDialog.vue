<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { BookOpen, Check, Loader2 } from '@lucide/vue';
import { toast } from 'vue-sonner';
import TagAutocompleteField from '@/components/prompt/TagAutocompleteField.vue';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LibraryService } from '@/services/libraryService';
import { useLibraryStore } from '@/stores/libraryStore';
import type { CharacterData, CharacterDraft } from '@/types/library';

const props = defineProps<{ draft: CharacterDraft | null }>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ 'open-library': [] }>();

const router = useRouter();
const name = ref('');
const trigger = ref('');
const series = ref('');
const tags = ref('');
const isSaving = ref(false);

watch(open, (isOpen) => {
  if (!isOpen || !props.draft) return;
  name.value = props.draft.name;
  trigger.value = props.draft.trigger;
  series.value = props.draft.series;
  tags.value = props.draft.tags.join(', ');
});

function fallbackTrigger(): string {
  return name.value.trim().toLowerCase().replaceAll(' ', '_');
}

async function save() {
  const draft = props.draft;
  if (!draft || !name.value.trim()) return;
  isSaving.value = true;
  try {
    let thumbnailId: string | undefined;
    if (draft.thumbnailUrl) {
      try {
        thumbnailId = await LibraryService.saveThumbnailFromUrl(
          `${draft.source}-char-${Date.now()}`,
          draft.thumbnailUrl
        );
      } catch (err) {
        console.warn('Could not save thumbnail for character:', err);
      }
    }

    const item = await LibraryService.saveItem<CharacterData>({
      category: 'characters',
      name: name.value.trim(),
      description: series.value.trim()
        ? `From ${series.value.trim()}`
        : undefined,
      thumbnailId,
      data: {
        trigger: trigger.value.trim() || fallbackTrigger(),
        tags: tags.value
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        series: series.value.trim() || undefined,
        source: draft.source,
        animadexSlug: draft.animadexSlug
      }
    });

    void useLibraryStore().fetchCategory('characters');
    open.value = false;
    toast.success(`Saved "${item.name}" to Character Library!`, {
      action: {
        label: 'Open Library',
        onClick: () => {
          emit('open-library');
          void router.push('/library');
        }
      }
    });
  } catch (err) {
    toast.error(
      `Failed to save character: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      class="border-border bg-card flex max-h-[90vh] w-full min-w-[60vw] flex-col gap-0 overflow-hidden p-0 shadow-2xl"
    >
      <DialogHeader
        class="border-border bg-background/50 shrink-0 border-b px-5 py-4"
      >
        <DialogTitle
          class="text-foreground flex items-center gap-2 text-sm font-bold"
        >
          <BookOpen class="text-primary h-4 w-4" />
          <span>Save to Character Library</span>
        </DialogTitle>
      </DialogHeader>

      <div class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div class="grid grid-cols-1 items-start gap-6 md:grid-cols-3">
          <div class="flex flex-col gap-4 md:col-span-2">
            <div class="flex flex-col gap-1.5">
              <Label class="text-foreground text-xs font-bold">
                Character Name <span class="text-destructive">*</span>
              </Label>
              <Input
                v-model="name"
                placeholder="e.g. Hatsune Miku"
                class="text-xs"
              />
            </div>

            <div class="flex flex-col gap-1.5">
              <Label class="text-foreground text-xs font-bold">
                Trigger Tag <span class="text-destructive">*</span>
              </Label>
              <TagAutocompleteField
                v-model="trigger"
                placeholder="e.g. hatsune_miku"
                class="font-mono text-xs"
              />
            </div>

            <div class="flex flex-col gap-1.5">
              <Label class="text-foreground text-xs font-bold">
                Series / Copyright (optional)
              </Label>
              <Input
                v-model="series"
                placeholder="e.g. Vocaloid"
                class="text-xs"
              />
            </div>

            <div class="flex flex-col gap-1.5">
              <Label class="text-foreground text-xs font-bold">
                Tags & Features
                <span class="text-muted-foreground font-normal"
                  >(comma-separated)</span
                >
              </Label>
              <TagAutocompleteField
                v-model="tags"
                multiline
                rows="4"
                placeholder="twin tails, sleeveless shirt, necktie..."
                class="bg-background font-mono text-xs"
              />
            </div>
          </div>

          <div class="flex flex-col gap-2 md:col-span-1">
            <Label class="text-foreground text-xs font-bold">Thumbnail</Label>
            <div
              class="border-border bg-muted/30 relative aspect-3/4 w-full overflow-hidden rounded-xl border"
            >
              <img
                v-if="draft?.thumbnailUrl"
                :src="draft.thumbnailUrl"
                alt="Character thumbnail"
                class="h-full w-full object-cover object-center"
              />
              <div
                v-else
                class="text-muted-foreground flex h-full w-full items-center justify-center text-xs"
              >
                No image selected
              </div>
            </div>
          </div>
        </div>
      </div>

      <DialogFooter
        class="border-border bg-muted/30 shrink-0 border-t px-5 py-3"
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
          class="bg-primary text-primary-foreground hover:bg-primary/90 gap-1.5 text-xs font-semibold"
          :disabled="!name.trim() || isSaving"
          @click="save"
        >
          <Loader2 v-if="isSaving" class="h-3.5 w-3.5 animate-spin" />
          <Check v-else class="h-3.5 w-3.5" />
          {{ isSaving ? 'Saving…' : 'Save to Library' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
