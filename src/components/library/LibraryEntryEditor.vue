<script setup lang="ts">
import { ref } from 'vue';
import {
  Image as ImageIcon,
  Layers,
  Loader2,
  Sparkles,
  Trash2,
  User,
  X
} from '@lucide/vue';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import TagAutocompleteField from '@/components/prompt/TagAutocompleteField.vue';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { invoke } from '@tauri-apps/api/core';
import { LibraryService } from '@/services/libraryService';
import { useLibraryStore } from '@/stores/libraryStore';
import type {
  LibraryListEntry,
  LoraData,
  PromptData,
  CharacterData
} from '@/types/library';
import { useWorkflowStore } from '@/stores/workflowStore';
import { toRef } from 'vue';

type CategoryTab = 'prompts' | 'loras' | 'characters';
const categoryTabs: Array<{ id: CategoryTab; label: string; icon: unknown }> = [
  { id: 'prompts', label: 'Prompts', icon: Sparkles },
  { id: 'loras', label: 'LoRAs', icon: Layers },
  { id: 'characters', label: 'Characters', icon: User }
];
const props = defineProps<{ category: CategoryTab }>();
const activeTab = toRef(props, 'category');
const emit = defineEmits<{ delete: [entry: LibraryListEntry] }>();
const libraryStore = useLibraryStore();
const workflowStore = useWorkflowStore();
const isEditorOpen = ref(false);
const isEditorLoading = ref(false);
const editorMode = ref<'create' | 'edit'>('create');
const editorId = ref('');
const editorName = ref('');
const editorDescription = ref('');
const editorThumbnailId = ref('');
const editorThumbnailPreview = ref('');
const editorCreatedAt = ref(0);
const editorPromptType = ref<'both' | 'positive' | 'negative'>('both');
const editorPositive = ref('');
const editorNegative = ref('');
const editorLoras = ref<
  Array<{ name: string; strength: number; enabled: boolean }>
>([]);
const editorCharSeries = ref('');
const editorCharTrigger = ref('');
const editorCharTags = ref('');
const editorCharSource = ref<'local' | 'animadex' | 'manual'>('local');
const editorCharAnimadexSlug = ref('');
const editorCharNotes = ref('');
const editorSaveError = ref('');
const editorIsSaving = ref(false);
function resetEditor() {
  editorId.value = '';
  editorName.value = '';
  editorDescription.value = '';
  editorThumbnailId.value = '';
  editorThumbnailPreview.value = '';
  editorCreatedAt.value = 0;
  editorPromptType.value = 'both';
  editorPositive.value = '';
  editorNegative.value = '';
  editorLoras.value = workflowStore.loras.map((l) => ({
    name: l.name,
    strength: l.strength,
    enabled: l.enabled
  }));
  editorCharSeries.value = '';
  editorCharTrigger.value = '';
  editorCharTags.value = '';
  editorCharSource.value = 'local';
  editorCharAnimadexSlug.value = '';
  editorCharNotes.value = '';
  editorSaveError.value = '';
}
function openCreateEditor() {
  resetEditor();
  if (activeTab.value === 'prompts') {
    editorPositive.value = workflowStore.positivePrompt;
    editorNegative.value = workflowStore.negativePrompt;
  }
  editorMode.value = 'create';
  isEditorOpen.value = true;
}
async function openEditEditor(entry: LibraryListEntry) {
  resetEditor();
  editorMode.value = 'edit';
  isEditorLoading.value = true;
  isEditorOpen.value = true;

  try {
    if (activeTab.value === 'prompts') {
      const item = await LibraryService.getItem<PromptData>(
        entry.id,
        entry.category
      );
      editorId.value = item.id;
      editorName.value = item.name;
      editorDescription.value = item.description ?? '';
      editorThumbnailId.value = item.thumbnailId ?? '';
      editorThumbnailPreview.value = item.thumbnailUrl ?? '';
      editorCreatedAt.value = item.createdAt;
      editorPromptType.value = item.data.type;
      editorPositive.value = item.data.positive ?? '';
      editorNegative.value = item.data.negative ?? '';
    } else if (activeTab.value === 'loras') {
      const item = await LibraryService.getItem<LoraData>(
        entry.id,
        entry.category
      );
      editorId.value = item.id;
      editorName.value = item.name;
      editorDescription.value = item.description ?? '';
      editorThumbnailId.value = item.thumbnailId ?? '';
      editorThumbnailPreview.value = item.thumbnailUrl ?? '';
      editorCreatedAt.value = item.createdAt;
      editorLoras.value = item.data.loras;
    } else if (activeTab.value === 'characters') {
      const item = await LibraryService.getItem<CharacterData>(
        entry.id,
        entry.category
      );
      editorId.value = item.id;
      editorName.value = item.name;
      editorDescription.value = item.description ?? '';
      editorThumbnailId.value = item.thumbnailId ?? '';
      editorThumbnailPreview.value = item.thumbnailUrl ?? '';
      editorCreatedAt.value = item.createdAt;
      editorCharSeries.value = item.data.series ?? '';
      editorCharTrigger.value = item.data.trigger;
      editorCharTags.value = item.data.tags.join(', ');
      editorCharSource.value =
        item.data.source === 'animadex' || item.data.source === 'manual'
          ? item.data.source
          : 'local';
      editorCharAnimadexSlug.value = item.data.animadexSlug ?? '';
      editorCharNotes.value = item.data.notes ?? '';
    }
  } finally {
    isEditorLoading.value = false;
  }
}
async function handleSave() {
  if (!editorName.value.trim()) return;
  editorIsSaving.value = true;
  editorSaveError.value = '';

  try {
    let data: PromptData | LoraData | CharacterData;

    if (activeTab.value === 'prompts') {
      data = {
        type: editorPromptType.value,
        positive:
          editorPromptType.value === 'negative'
            ? undefined
            : editorPositive.value,
        negative:
          editorPromptType.value === 'positive'
            ? undefined
            : editorNegative.value
      } satisfies PromptData;
    } else if (activeTab.value === 'loras') {
      data = { loras: editorLoras.value } satisfies LoraData;
    } else {
      data = {
        series: editorCharSeries.value.trim() || undefined,
        trigger: editorCharTrigger.value.trim(),
        tags: editorCharTags.value
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        source: editorCharSource.value,
        animadexSlug: editorCharAnimadexSlug.value.trim() || undefined,
        notes: editorCharNotes.value.trim() || undefined
      } satisfies CharacterData;
    }

    const payload = {
      id: editorId.value || '',
      category: activeTab.value,
      name: editorName.value.trim(),
      description: editorDescription.value.trim() || undefined,
      thumbnailId: editorThumbnailId.value || undefined,
      data,
      createdAt: editorCreatedAt.value || Date.now(),
      updatedAt: Date.now()
    };

    await libraryStore.saveItem(payload);
    isEditorOpen.value = false;
  } catch (err) {
    editorSaveError.value = String(err);
  } finally {
    editorIsSaving.value = false;
  }
}
async function pickThumbnail() {
  try {
    const path = await invoke<string | null>('pick_file', {
      title: 'Select Thumbnail Image',
      filterName: 'Images',
      filterExtensions: ['png', 'jpg', 'jpeg', 'webp']
    });
    if (!path) return;

    // We need an ID for the thumbnail filename — use a temp one if creating
    const tempId = editorId.value || `tmp-${Date.now()}`;
    const thumbId = await LibraryService.saveThumbnailFromPath(tempId, path);
    editorThumbnailId.value = thumbId;
    editorThumbnailPreview.value = LibraryService.getThumbnailUrl(thumbId);
  } catch (err) {
    console.warn('Thumbnail pick failed:', err);
  }
}
function handleThumbnailDrop(event: DragEvent) {
  const file = event.dataTransfer?.files?.[0];
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target?.result as string;
    if (!dataUrl) return;
    const tempId = editorId.value || `tmp-${Date.now()}`;
    try {
      const thumbId = await LibraryService.saveThumbnailFromDataUrl(
        tempId,
        dataUrl
      );
      editorThumbnailId.value = thumbId;
      editorThumbnailPreview.value = LibraryService.getThumbnailUrl(thumbId);
    } catch (err) {
      console.warn('Thumbnail drag-drop failed:', err);
    }
  };
  reader.readAsDataURL(file);
}
function requestDeleteFromEditor() {
  if (!editorId.value) return;
  const current = libraryStore
    .getEntries(activeTab.value)
    .find((e) => e.id === editorId.value);
  if (current) {
    emit('delete', current);
  } else {
    emit('delete', {
      id: editorId.value,
      category: activeTab.value,
      name: editorName.value,
      data: {},
      createdAt: editorCreatedAt.value || Date.now(),
      updatedAt: Date.now()
    });
  }
}
function closeDeleted(id: string) {
  if (editorId.value === id) isEditorOpen.value = false;
}
defineExpose({ create: openCreateEditor, edit: openEditEditor, closeDeleted });
</script>
<template>
  <Dialog :open="isEditorOpen" @update:open="(v) => (isEditorOpen = v)">
    <DialogContent
      class="border-border bg-card flex max-h-[90vh] w-full min-w-[60vw] flex-col gap-0 overflow-hidden p-0"
    >
      <DialogHeader
        class="border-border bg-background/50 shrink-0 flex-row items-center justify-between border-b px-5 py-4"
      >
        <DialogTitle
          class="text-foreground flex items-center gap-2 text-sm font-bold"
        >
          <component
            :is="categoryTabs.find((t) => t.id === activeTab)?.icon"
            class="text-primary h-4 w-4"
          />
          {{
            editorMode === 'create'
              ? `Add ${categoryTabs.find((t) => t.id === activeTab)?.label} Entry`
              : `Edit "${editorName}"`
          }}
        </DialogTitle>
        <DialogCloseButton class="-my-1.5" />
      </DialogHeader>

      <div
        v-if="isEditorLoading"
        class="flex items-center justify-center py-12"
      >
        <Loader2 class="text-primary h-6 w-6 animate-spin" />
      </div>

      <div
        v-else
        class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5"
      >
        <!-- Error banner -->
        <div
          v-if="editorSaveError"
          class="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-400"
        >
          <X class="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{{ editorSaveError }}</span>
        </div>

        <div class="grid grid-cols-1 items-start gap-6 md:grid-cols-3">
          <!-- Left (2 cols): Core form fields & category-specific inputs -->
          <div class="flex flex-col gap-4 md:col-span-2">
            <!-- Common: Name -->
            <div class="flex flex-col gap-1.5">
              <Label class="text-foreground text-xs font-bold"
                >Name <span class="text-destructive">*</span></Label
              >
              <Input
                v-model="editorName"
                placeholder="Give this entry a name..."
                class="text-xs"
              />
            </div>

            <!-- Common: Description -->
            <div class="flex flex-col gap-1.5">
              <Label class="text-foreground text-xs font-bold"
                >Description</Label
              >
              <Input
                v-model="editorDescription"
                placeholder="Short description..."
                class="text-xs"
              />
            </div>

            <div class="border-border border-t" />

            <!-- ── PROMPT FIELDS ── -->
            <template v-if="activeTab === 'prompts'">
              <div class="flex flex-col gap-1.5">
                <Label class="text-foreground text-xs font-bold">Scope</Label>
                <div class="grid grid-cols-3 gap-2">
                  <button
                    v-for="st in [
                      { val: 'both', title: 'Both', desc: 'Pos & Neg' },
                      {
                        val: 'positive',
                        title: 'Positive',
                        desc: 'Pos only'
                      },
                      { val: 'negative', title: 'Negative', desc: 'Neg only' }
                    ]"
                    :key="st.val"
                    type="button"
                    class="border-border hover:border-primary/60 flex cursor-pointer flex-col gap-0.5 rounded-lg border p-2 text-left transition-all"
                    :class="
                      editorPromptType === st.val
                        ? 'border-primary bg-primary/10 ring-primary/20 ring-1'
                        : 'bg-card text-muted-foreground'
                    "
                    @click="editorPromptType = st.val as any"
                  >
                    <span class="text-foreground text-xs font-bold">{{
                      st.title
                    }}</span>
                    <span class="text-muted-foreground text-xs">{{
                      st.desc
                    }}</span>
                  </button>
                </div>
              </div>

              <div
                v-if="editorPromptType !== 'negative'"
                class="flex flex-col gap-1.5"
              >
                <Label
                  class="font-mono text-xs font-bold text-emerald-400 uppercase"
                  >Positive Prompt</Label
                >
                <TagAutocompleteField
                  v-model="editorPositive"
                  multiline
                  rows="3"
                  placeholder="Positive prompt text..."
                  class="bg-background font-mono text-xs"
                />
              </div>

              <div
                v-if="editorPromptType !== 'positive'"
                class="flex flex-col gap-1.5"
              >
                <Label
                  class="font-mono text-xs font-bold text-rose-400 uppercase"
                  >Negative Prompt</Label
                >
                <TagAutocompleteField
                  v-model="editorNegative"
                  multiline
                  rows="3"
                  placeholder="Negative prompt text..."
                  class="bg-background font-mono text-xs"
                />
              </div>
            </template>

            <!-- ── LORA FIELDS ── -->
            <template v-else-if="activeTab === 'loras'">
              <div class="flex flex-col gap-2">
                <div class="flex items-center justify-between">
                  <Label class="text-foreground text-xs font-bold"
                    >LoRA Stack</Label
                  >
                  <span class="text-muted-foreground font-mono text-xs">
                    {{ editorLoras.length }} LoRA{{
                      editorLoras.length !== 1 ? 's' : ''
                    }}
                  </span>
                </div>

                <div
                  v-if="editorLoras.length === 0"
                  class="border-border text-muted-foreground rounded-lg border border-dashed p-4 text-center text-xs"
                >
                  No LoRAs in stack. This entry will save an empty LoRA stack.
                </div>

                <div
                  v-else
                  class="border-border flex max-h-48 flex-col gap-1.5 overflow-y-auto rounded-lg border p-2"
                >
                  <div
                    v-for="(lora, i) in editorLoras"
                    :key="i"
                    class="border-border bg-card/60 flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs"
                  >
                    <span class="truncate font-mono">{{
                      lora.name || '(No model)'
                    }}</span>
                    <div class="flex shrink-0 items-center gap-2">
                      <span
                        class="rounded px-1.5 py-0.5 font-mono text-xs font-bold"
                        :class="
                          lora.enabled
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : 'bg-muted text-muted-foreground'
                        "
                      >
                        {{ lora.enabled ? 'ON' : 'OFF' }}
                      </span>
                      <span
                        class="border-border bg-muted text-primary rounded border px-1.5 py-0.5 font-mono text-xs font-bold"
                      >
                        {{ lora.strength }}x
                      </span>
                    </div>
                  </div>
                </div>

                <p class="text-muted-foreground text-xs">
                  The LoRA stack above is pre-filled from your current workflow.
                  Edit from the workflow panel before saving.
                </p>
              </div>
            </template>

            <!-- ── CHARACTER FIELDS ── -->
            <template v-else-if="activeTab === 'characters'">
              <div class="flex flex-col gap-1.5">
                <Label class="text-foreground text-xs font-bold">
                  Trigger Tag <span class="text-destructive">*</span>
                </Label>
                <TagAutocompleteField
                  v-model="editorCharTrigger"
                  placeholder="e.g. hatsune_miku"
                  class="font-mono text-xs"
                />
              </div>

              <div class="flex flex-col gap-1.5">
                <Label class="text-foreground text-xs font-bold"
                  >Series / Copyright</Label
                >
                <Input
                  v-model="editorCharSeries"
                  placeholder="e.g. Vocaloid"
                  class="text-xs"
                />
              </div>

              <div class="flex flex-col gap-1.5">
                <Label class="text-foreground text-xs font-bold">
                  Additional Tags
                </Label>
                <TagAutocompleteField
                  v-model="editorCharTags"
                  multiline
                  rows="3"
                  placeholder="long hair, blue hair, twin tails, teal eyes, detached sleeves, ..."
                  class="bg-background font-mono text-xs"
                />
                <p class="text-muted-foreground text-xs">
                  Include clothing, hair, eyes, accessories — the more complete
                  the better.
                </p>
              </div>

              <div class="grid grid-cols-2 gap-4">
                <div class="flex flex-col gap-1.5">
                  <Label class="text-foreground text-xs font-bold"
                    >Source</Label
                  >
                  <Select v-model="editorCharSource">
                    <SelectTrigger class="h-8 w-full text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="local"
                          >Local (manually entered)</SelectItem
                        >
                        <SelectItem value="animadex"
                          >Imported from Animadex</SelectItem
                        >
                        <SelectItem value="manual"
                          >Manual verification</SelectItem
                        >
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>

                <div class="flex flex-col gap-1.5">
                  <Label class="text-foreground text-xs font-bold"
                    >Animadex Slug</Label
                  >
                  <Input
                    v-model="editorCharAnimadexSlug"
                    placeholder="e.g. hatsune-miku"
                    class="font-mono text-xs"
                  />
                </div>
              </div>

              <div class="flex flex-col gap-1.5">
                <Label class="text-foreground text-xs font-bold">Notes</Label>
                <Textarea
                  v-model="editorCharNotes"
                  rows="5"
                  placeholder="Anything tags can't capture: personality, canon outfits by arc, signature poses or expressions, tags to avoid, LoRA that works best..."
                  class="bg-background text-xs"
                />
                <p class="text-muted-foreground text-xs">
                  Maya reads these notes together with the tags when you ask
                  about this character.
                </p>
              </div>
            </template>
          </div>

          <!-- Right (1 col): Portrait Thumbnail Box -->
          <div class="flex flex-col gap-2 md:col-span-1">
            <Label class="text-foreground text-xs font-bold">Thumbnail</Label>
            <div
              class="border-border hover:border-primary/50 bg-muted/20 relative flex aspect-3/4 w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed transition-colors"
              @click="pickThumbnail"
              @dragover.prevent
              @drop.prevent="handleThumbnailDrop"
            >
              <img
                v-if="editorThumbnailPreview"
                :src="editorThumbnailPreview"
                alt="Thumbnail preview"
                class="h-full w-full object-cover object-center"
              />
              <div
                v-else
                class="flex flex-col items-center gap-2 p-4 text-center"
              >
                <div
                  class="bg-muted text-muted-foreground flex h-10 w-10 items-center justify-center rounded-full"
                >
                  <ImageIcon class="h-5 w-5 opacity-60" />
                </div>
                <div>
                  <p class="text-foreground text-xs font-semibold">
                    Drop portrait image
                  </p>
                  <p class="text-muted-foreground mt-0.5 text-xs">
                    or click to browse
                  </p>
                </div>
                <span
                  class="border-border bg-muted/60 text-muted-foreground mt-1 rounded px-2 py-0.5 font-mono text-xs"
                >
                  3:4 / Portrait
                </span>
              </div>
              <button
                v-if="editorThumbnailPreview"
                type="button"
                class="absolute top-2 right-2 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-black/70 text-white transition-colors hover:bg-black/90"
                title="Remove thumbnail"
                @click.stop="
                  editorThumbnailId = '';
                  editorThumbnailPreview = '';
                "
              >
                <X class="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <DialogFooter
        class="border-border bg-muted/30 flex shrink-0 items-center justify-between border-t px-5 py-3 sm:justify-between"
      >
        <div>
          <Button
            v-if="editorMode === 'edit'"
            variant="ghost"
            size="default"
            class="text-destructive hover:bg-destructive/10 hover:text-destructive h-8 gap-1 px-2.5 text-xs"
            @click="requestDeleteFromEditor"
          >
            <Trash2 class="h-3.5 w-3.5" />
            <span>Delete</span>
          </Button>
        </div>
        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="default"
            class="text-xs"
            @click="isEditorOpen = false"
          >
            Cancel
          </Button>
          <Button
            size="default"
            class="bg-primary text-primary-foreground hover:bg-primary/90 gap-1.5 text-xs font-semibold"
            :disabled="!editorName.trim() || editorIsSaving"
            @click="handleSave"
          >
            Save
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
