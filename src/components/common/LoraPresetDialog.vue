<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  ArrowUpRight,
  Check,
  Clock,
  FolderOpen,
  Layers,
  Library,
  Plus,
  PlusCircle,
  RefreshCw,
  Search,
  Trash2,
  X,
  Zap
} from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { useConfirmDialog } from '@/composables/useConfirmDialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatShortDate } from '@/utils/formatters';
import { LibraryService } from '../../services/libraryService';
import { useWorkflowStore } from '../../stores/workflowStore';
import type {
  LibraryItem,
  LibraryListEntry,
  LoraData
} from '../../types/library';
import type { LoraItem } from '../../types/workflow';

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:open', val: boolean): void;
}>();

const workflowStore = useWorkflowStore();
const { confirm } = useConfirmDialog();

const stack = defineModel<LoraItem[]>('loras');
const loras = computed({
  get: () => stack.value ?? workflowStore.loras,
  set: (value) => {
    if (stack.value === undefined) workflowStore.loras = value;
    else stack.value = value;
  }
});

const activeTab = ref<'load' | 'save'>('load');
const entries = ref<LibraryListEntry[]>([]);
const failedThumbnails = ref<Set<string>>(new Set());
const isLoading = ref(false);
const searchQuery = ref('');

// Form state for saving
const saveName = ref('');
const saveDescription = ref('');
const saveSuccessMessage = ref('');

async function fetchEntries() {
  isLoading.value = true;
  failedThumbnails.value.clear();
  entries.value = await LibraryService.listItems('loras');
  isLoading.value = false;
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      void fetchEntries();
      saveSuccessMessage.value = '';
      if (!saveName.value) {
        saveName.value = `LoRA Stack ${new Date().toLocaleDateString()}`;
      }
    }
  }
);

onMounted(() => {
  if (props.open) {
    void fetchEntries();
  }
});

const filteredEntries = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  return entries.value.filter((e) => {
    if (q) {
      const inName = e.name.toLowerCase().includes(q);
      const inDesc = e.description?.toLowerCase().includes(q) ?? false;
      return inName || inDesc;
    }
    return true;
  });
});

async function applyLoraPreset(entry: LibraryListEntry, append = false) {
  const item = await LibraryService.getItem<LoraData>(entry.id, 'loras');
  const newItems: LoraItem[] = item.data.loras.map((l, index) => ({
    id: `lora-${index}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    name: l.name,
    strength: l.strength,
    enabled: l.enabled
  }));

  if (append) {
    loras.value.push(...newItems);
  } else {
    loras.value = newItems;
  }

  emit('update:open', false);
}

async function handleSavePreset() {
  if (!saveName.value.trim()) return;

  const data: LoraData = {
    loras: loras.value.map((l) => ({
      name: l.name,
      strength: l.strength,
      enabled: l.enabled
    }))
  };

  const payload: Omit<LibraryItem<LoraData>, 'thumbnailUrl'> = {
    id: '',
    category: 'loras',
    name: saveName.value.trim(),
    description: saveDescription.value.trim() || undefined,
    data,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await LibraryService.saveItem(payload);
  saveSuccessMessage.value = `Saved "${saveName.value.trim()}" (${data.loras.length} LoRAs) to Library!`;
  saveName.value = '';
  saveDescription.value = '';
  await fetchEntries();
  setTimeout(() => {
    activeTab.value = 'load';
    saveSuccessMessage.value = '';
  }, 900);
}

async function requestDelete(entry: LibraryListEntry) {
  const confirmed = await confirm({
    title: 'Delete LoRA Preset?',
    description: `Are you sure you want to delete "${entry.name}"? This will permanently remove this preset from your LoRA library.`
  });
  if (!confirmed) return;

  try {
    await LibraryService.deleteItem(entry.id, 'loras');
    await fetchEntries();
  } catch (err) {
    console.error('Failed to delete LoRA preset:', err);
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(val) => emit('update:open', val)">
    <DialogContent
      class="border-border bg-card flex max-h-[88vh] w-full max-w-5xl min-w-[70vw] flex-col gap-0 overflow-hidden p-0 shadow-2xl"
    >
      <!-- Dialog Header -->
      <DialogHeader
        class="border-border bg-background/50 flex flex-row items-center justify-between border-b px-5 py-3.5"
      >
        <div class="flex items-center gap-2.5">
          <div
            class="bg-primary/10 text-primary border-primary/20 flex h-8 w-8 items-center justify-center rounded-lg border"
          >
            <Zap class="h-4 w-4" />
          </div>
          <div>
            <DialogTitle
              class="text-foreground text-sm font-bold tracking-tight"
            >
              LoRA Stack Presets
            </DialogTitle>
            <DialogDescription class="text-muted-foreground text-xs">
              Save and load complete LoRA stacks from your Library.
            </DialogDescription>
          </div>
        </div>

        <!-- Header Actions -->
        <div class="flex items-center gap-2 pr-6">
          <Button
            size="sm"
            variant="outline"
            title="Open full Library"
            class="border-border bg-secondary hover:bg-accent h-7.5 gap-1 px-2.5 text-xs"
            @click="
              emit('update:open', false);
              $router.push('/library?tab=loras');
            "
          >
            <Library class="h-3.5 w-3.5" />
            <span>Open Library</span>
            <ArrowUpRight class="h-3 w-3" />
          </Button>

          <Button
            size="sm"
            variant="outline"
            title="Open library folder"
            class="border-border bg-secondary hover:bg-accent h-7.5 gap-1 px-2.5 text-xs"
            @click="LibraryService.openFolder('loras')"
          >
            <FolderOpen class="h-3.5 w-3.5" />
            <span>Open Folder</span>
          </Button>

          <Button
            size="iconSm"
            variant="outline"
            :disabled="isLoading"
            title="Refresh presets from disk"
            class="border-border bg-secondary hover:bg-accent h-7.5 w-7.5"
            @click="fetchEntries"
          >
            <RefreshCw
              class="h-3.5 w-3.5"
              :class="{ 'animate-spin': isLoading }"
            />
          </Button>
        </div>
      </DialogHeader>

      <!-- Main Tabs Container -->
      <Tabs v-model="activeTab" class="flex flex-1 flex-col overflow-hidden">
        <div class="border-border bg-muted/20 border-b px-6 py-3">
          <TabsList class="bg-muted/80 h-10 gap-1 rounded-lg p-1">
            <TabsTrigger
              value="load"
              class="data-[state=active]:bg-background data-[state=active]:text-foreground flex items-center gap-2 rounded-md px-4 py-2 text-xs font-semibold transition-all data-[state=active]:shadow-xs"
            >
              <Layers class="h-3.5 w-3.5" />
              Load Stack Preset ({{ entries.length }})
            </TabsTrigger>
            <TabsTrigger
              value="save"
              class="data-[state=active]:bg-background data-[state=active]:text-foreground flex items-center gap-2 rounded-md px-4 py-2 text-xs font-semibold transition-all data-[state=active]:shadow-xs"
            >
              <PlusCircle class="h-3.5 w-3.5" />
              Save Current Stack ({{ loras.length }} LoRAs)
            </TabsTrigger>
          </TabsList>
        </div>

        <!-- TAB 1: LOAD PRESETS -->
        <TabsContent
          value="load"
          class="m-0 flex flex-1 flex-col overflow-hidden outline-hidden"
        >
          <!-- Search Toolbar -->
          <div
            class="border-border bg-card/20 flex items-center justify-between gap-3 border-b px-6 py-3"
          >
            <div class="relative min-w-65 flex-1">
              <Search
                class="text-muted-foreground absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2"
              />
              <Input
                v-model="searchQuery"
                placeholder="Search presets by name or description..."
                class="bg-background/80 focus:ring-primary/30 h-8 w-full pr-8 pl-8.5 text-xs"
              />
              <button
                v-if="searchQuery"
                type="button"
                class="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2 cursor-pointer"
                @click="searchQuery = ''"
              >
                <X class="h-3.5 w-3.5" />
              </button>
            </div>

            <div class="text-muted-foreground font-mono text-xs">
              {{ filteredEntries.length }} presets available
            </div>
          </div>

          <!-- Presets List Area -->
          <ScrollArea class="h-[52vh] px-5 py-4">
            <!-- Empty State -->
            <div
              v-if="filteredEntries.length === 0"
              class="flex h-56 flex-col items-center justify-center gap-2 text-center"
            >
              <div
                class="bg-muted text-muted-foreground flex h-12 w-12 items-center justify-center rounded-full"
              >
                <Layers class="h-6 w-6 opacity-40" />
              </div>
              <span class="text-foreground text-xs font-semibold"
                >No LoRA presets found</span
              >
              <p class="text-muted-foreground max-w-sm text-xs">
                {{
                  searchQuery
                    ? `No presets match "${searchQuery}".`
                    : 'No LoRA stack presets in your Library yet. Click "Save Current Stack" to save your configured LoRA stack.'
                }}
              </p>
            </div>

            <!-- Presets Grid / Cards -->
            <div v-else class="grid grid-cols-1 gap-3.5 md:grid-cols-2">
              <div
                v-for="entry in filteredEntries"
                :key="entry.id"
                class="border-border bg-card hover:border-primary/50 relative flex min-h-36 flex-row overflow-hidden rounded-xl border transition-all hover:shadow-md"
              >
                <!-- Left: Content & Actions -->
                <div class="flex min-w-0 flex-1 flex-col justify-between p-3.5">
                  <!-- Top: Badge + Date + Title + Desc -->
                  <div>
                    <div class="flex items-center justify-between gap-2">
                      <span
                        class="rounded-md border border-violet-500/30 bg-violet-500/15 px-1.5 py-0.5 font-mono text-xs font-bold text-violet-400 uppercase"
                      >
                        LoRA
                      </span>

                      <div
                        class="text-muted-foreground/70 flex items-center gap-1 font-mono text-xs"
                      >
                        <Clock class="h-2.5 w-2.5" />
                        <span>{{ formatShortDate(entry.updatedAt) }}</span>
                      </div>
                    </div>

                    <div class="mt-2">
                      <h4
                        class="text-foreground truncate text-sm leading-snug font-bold"
                        :title="entry.name"
                      >
                        {{ entry.name }}
                      </h4>
                      <p
                        v-if="entry.description"
                        class="text-muted-foreground mt-1 line-clamp-2 text-xs leading-relaxed"
                        :title="entry.description"
                      >
                        {{ entry.description }}
                      </p>
                    </div>
                  </div>

                  <!-- Bottom: Action Buttons -->
                  <div
                    class="border-border/60 mt-3 flex items-center justify-between gap-2 border-t pt-2.5"
                  >
                    <!-- Left: Delete -->
                    <div class="flex shrink-0 items-center gap-1">
                      <Button
                        size="iconSm"
                        variant="ghost"
                        class="text-muted-foreground hover:text-destructive h-7 w-7"
                        title="Delete Preset"
                        @click="requestDelete(entry)"
                      >
                        <Trash2 class="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    <!-- Right: Apply Buttons -->
                    <div
                      class="flex flex-wrap items-center justify-end gap-1.5"
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        class="h-7 px-2.5 text-xs"
                        title="Append these LoRAs to existing chain"
                        @click="applyLoraPreset(entry, true)"
                      >
                        + Append
                      </Button>

                      <Button
                        size="sm"
                        class="bg-primary text-primary-foreground hover:bg-primary/90 h-7 px-3 text-xs font-semibold"
                        @click="applyLoraPreset(entry, false)"
                      >
                        Apply Stack
                      </Button>
                    </div>
                  </div>
                </div>

                <!-- Right: Portrait Thumbnail -->
                <div
                  class="bg-muted/40 border-border/50 relative w-24 shrink-0 self-stretch overflow-hidden border-l sm:w-28"
                >
                  <img
                    v-if="entry.thumbnailUrl && !failedThumbnails.has(entry.id)"
                    :src="entry.thumbnailUrl"
                    :alt="entry.name"
                    class="h-full w-full object-cover object-center"
                    @error="failedThumbnails.add(entry.id)"
                  />
                  <div
                    v-else
                    class="from-primary/5 to-primary/20 flex h-full w-full items-center justify-center bg-linear-to-br"
                  >
                    <Layers class="text-primary/25 h-7 w-7" />
                  </div>
                </div>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        <!-- TAB 2: SAVE CURRENT STACK -->
        <TabsContent
          value="save"
          class="m-0 flex flex-1 flex-col overflow-hidden outline-hidden"
        >
          <ScrollArea class="h-[56vh] px-6 py-5.5">
            <div class="flex w-full flex-col gap-5">
              <!-- Success Banner -->
              <div
                v-if="saveSuccessMessage"
                class="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs font-semibold text-emerald-400"
              >
                <Check class="h-4 w-4" />
                <span>{{ saveSuccessMessage }}</span>
              </div>

              <!-- Preset Name -->
              <div class="flex flex-col gap-1.5">
                <Label class="text-foreground text-xs font-bold"
                  >Preset Name</Label
                >
                <Input
                  v-model="saveName"
                  placeholder="e.g. Masterpiece Anime Style Stack"
                  class="text-xs"
                />
              </div>

              <!-- Optional Description -->
              <div class="flex flex-col gap-1.5">
                <Label class="text-foreground text-xs font-bold"
                  >Description (Optional)</Label
                >
                <Input
                  v-model="saveDescription"
                  placeholder="e.g. For character and color correction"
                  class="text-xs"
                />
              </div>

              <!-- Current LoRA Stack Preview -->
              <div class="border-border flex flex-col gap-2.5 border-t pt-3">
                <div class="flex items-center justify-between">
                  <span
                    class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
                  >
                    Current LoRA Stack ({{ loras.length }} Items)
                  </span>
                </div>

                <div
                  v-if="loras.length === 0"
                  class="border-border text-muted-foreground rounded-lg border border-dashed p-4 text-center text-xs"
                >
                  No LoRAs currently in stack. Add some LoRAs first before
                  saving.
                </div>

                <div v-else class="flex flex-col gap-1.5">
                  <div
                    v-for="(lora, lIdx) in loras"
                    :key="lora.id"
                    class="border-border bg-card/60 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs"
                  >
                    <div class="flex items-center gap-2 truncate">
                      <span
                        class="text-muted-foreground font-mono text-xs font-bold"
                        >#{{ lIdx + 1 }}</span
                      >
                      <span class="truncate font-mono font-medium">{{
                        lora.name || '(No model selected)'
                      }}</span>
                    </div>
                    <div class="flex shrink-0 items-center gap-2">
                      <span
                        class="py-0.2 rounded px-1.5 font-mono text-xs font-bold uppercase"
                        :class="
                          lora.enabled
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : 'bg-muted text-muted-foreground'
                        "
                      >
                        {{ lora.enabled ? 'Enabled' : 'Disabled' }}
                      </span>
                      <span
                        class="border-border bg-muted text-primary rounded border px-1.5 py-0.5 font-mono text-xs font-bold"
                      >
                        {{ lora.strength }}x
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </ScrollArea>

          <!-- Save Tab Footer -->
          <div
            class="border-border bg-muted/30 flex items-center justify-between border-t px-6 py-3"
          >
            <span class="text-muted-foreground text-xs">
              Saved to your
              <code class="text-foreground font-mono font-semibold"
                >Library / LoRAs</code
              >.
            </span>

            <Button
              class="bg-primary text-primary-foreground hover:bg-primary/90 gap-1.5 px-4 text-xs font-semibold"
              :disabled="!saveName.trim() || loras.length === 0"
              @click="handleSavePreset"
            >
              <Plus class="h-3.5 w-3.5" />
              <span>Save to Library</span>
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </DialogContent>
  </Dialog>
</template>
