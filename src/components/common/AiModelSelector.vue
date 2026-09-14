<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import {
  Check,
  ChevronsUpDown,
  CornerDownLeft,
  Eye,
  Plus,
  RefreshCw,
  Search,
  X
} from '@lucide/vue';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import type { HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';
import type { OpenRouterModel } from '../../types/ai';
import { useAiStore } from '../../stores/aiStore';

interface Props {
  modelValue?: string;
  compact?: boolean;
  disabled?: boolean;
  placeholder?: string;
  class?: HTMLAttributes['class'];
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: undefined,
  compact: false,
  disabled: false,
  placeholder: 'Select model',
  class: undefined
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'change', value: string): void;
}>();

const aiStore = useAiStore();
const isOpen = ref(false);
const searchQuery = ref('');
const searchInputRef = ref<HTMLInputElement | null>(null);

type CategoryFilter =
  'all' | 'vision' | 'google' | 'anthropic' | 'openai' | 'deepseek' | 'meta';

const activeCategory = ref<CategoryFilter>('all');

const currentModelId = computed<string>(() => {
  return props.modelValue ?? aiStore.config.selectedModel;
});

const currentModelInfo = computed<OpenRouterModel | undefined>(() => {
  return aiStore.models.find((m) => m.id === currentModelId.value);
});

const categories: Array<{ id: CategoryFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'vision', label: 'Vision' },
  { id: 'google', label: 'Google' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'meta', label: 'Meta' }
];

const filteredModels = computed<OpenRouterModel[]>(() => {
  let list = aiStore.models;

  if (activeCategory.value === 'vision') {
    list = list.filter((m) =>
      m.architecture?.input_modalities?.includes('image')
    );
  } else if (activeCategory.value === 'google') {
    list = list.filter((m) => m.id.toLowerCase().startsWith('google/'));
  } else if (activeCategory.value === 'anthropic') {
    list = list.filter((m) => m.id.toLowerCase().startsWith('anthropic/'));
  } else if (activeCategory.value === 'openai') {
    list = list.filter((m) => m.id.toLowerCase().startsWith('openai/'));
  } else if (activeCategory.value === 'deepseek') {
    list = list.filter((m) => m.id.toLowerCase().startsWith('deepseek/'));
  } else if (activeCategory.value === 'meta') {
    list = list.filter((m) => m.id.toLowerCase().startsWith('meta-llama/'));
  }

  const query = searchQuery.value.trim().toLowerCase();
  if (!query) {
    return list;
  }

  const tokens = query.split(/\s+/u).filter(Boolean);
  return list.filter((m) => {
    const target =
      `${m.id} ${m.name || ''} ${m.description || ''}`.toLowerCase();
    return tokens.every((token) => target.includes(token));
  });
});

const canUseCustomModel = computed<boolean>(() => {
  const q = searchQuery.value.trim();
  if (!q) return false;
  return !aiStore.models.some((m) => m.id.toLowerCase() === q.toLowerCase());
});

function handleSelectModel(id: string) {
  aiStore.config.selectedModel = id;
  emit('update:modelValue', id);
  emit('change', id);
  void aiStore.saveConfig();
  isOpen.value = false;
  searchQuery.value = '';
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault();
    if (filteredModels.value.length > 0) {
      handleSelectModel(filteredModels.value[0].id);
    } else if (canUseCustomModel.value) {
      handleSelectModel(searchQuery.value.trim());
    }
  }
}

watch(isOpen, (open) => {
  if (open) {
    searchQuery.value = '';
    void nextTick(() => {
      searchInputRef.value?.focus();
    });
  }
});
</script>

<template>
  <Popover v-model:open="isOpen">
    <PopoverTrigger as-child>
      <button
        type="button"
        :disabled="disabled"
        :class="
          cn(
            'border-input hover:bg-accent hover:text-accent-foreground bg-background/50 flex cursor-pointer items-center justify-between gap-1.5 rounded-md border text-xs transition-colors focus-visible:ring-1 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
            compact ? 'h-7 max-w-full px-2' : 'h-8 w-full px-2.5',
            props.class
          )
        "
        :title="currentModelId"
      >
        <div class="flex min-w-0 flex-1 items-center gap-1.5">
          <span class="truncate font-mono text-xs">
            {{ currentModelInfo?.name || currentModelId || placeholder }}
          </span>
          <Eye
            v-if="
              currentModelInfo?.architecture?.input_modalities?.includes(
                'image'
              )
            "
            class="text-primary mr-0.5 h-2.5 w-2.5"
          />
        </div>
        <ChevronsUpDown
          class="text-muted-foreground ml-1 h-3.5 w-3.5 shrink-0 opacity-60"
        />
      </button>
    </PopoverTrigger>

    <!-- Dropdown Content with Real-time Search -->
    <PopoverContent
      align="start"
      class="border-border bg-popover text-popover-foreground z-150 w-80 p-0 shadow-2xl sm:w-96"
    >
      <!-- Search Bar -->
      <div
        class="border-border/60 relative flex items-center border-b px-2.5 py-2"
      >
        <Search class="text-muted-foreground absolute left-3.5 h-3.5 w-3.5" />
        <Input
          ref="searchInputRef"
          v-model="searchQuery"
          type="text"
          placeholder="Search models"
          class="border-0 bg-transparent pr-7 pl-7 text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          @keydown="handleKeydown"
        />
        <button
          v-if="searchQuery"
          type="button"
          class="text-muted-foreground hover:text-foreground absolute right-3 cursor-pointer p-0.5"
          @click="searchQuery = ''"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </div>

      <!-- Category Filter Pills -->
      <div
        class="border-border/40 bg-muted/20 flex items-center gap-1 overflow-x-auto border-b px-2 py-1.5"
      >
        <button
          v-for="cat in categories"
          :key="cat.id"
          type="button"
          class="shrink-0 cursor-pointer rounded-md px-2 py-0.5 text-xs font-medium transition-colors"
          :class="
            activeCategory === cat.id
              ? 'bg-primary text-primary-foreground shadow-xs'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          "
          @click="activeCategory = cat.id"
        >
          {{ cat.label }}
        </button>
      </div>

      <!-- Models List -->
      <div class="max-h-64 overflow-y-auto p-1 text-xs">
        <button
          v-if="canUseCustomModel"
          type="button"
          class="border-border/50 bg-primary/5 hover:bg-primary/10 text-primary mb-1 flex w-full cursor-pointer items-center justify-between rounded-md border p-2 text-left transition-colors"
          @click="handleSelectModel(searchQuery.trim())"
        >
          <div class="flex items-center gap-2">
            <Plus class="h-3.5 w-3.5 shrink-0" />
            <div class="flex flex-col">
              <span class="font-medium">Use custom model ID</span>
              <span class="font-mono text-xs opacity-80">{{
                searchQuery.trim()
              }}</span>
            </div>
          </div>
          <CornerDownLeft class="h-3.5 w-3.5 opacity-60" />
        </button>

        <!-- Listed Models -->
        <button
          v-for="m in filteredModels"
          :key="m.id"
          type="button"
          class="hover:bg-accent/60 flex w-full cursor-pointer items-start justify-between rounded-md p-2 text-left transition-colors"
          :class="{
            'bg-accent/40 font-medium': m.id === currentModelId
          }"
          @click="handleSelectModel(m.id)"
        >
          <div class="flex min-w-0 flex-1 flex-col gap-0.5 pr-2">
            <div class="flex items-center gap-1.5">
              <span class="text-foreground truncate font-medium">
                {{ m.name || m.id }}
              </span>
              <Eye
                v-if="m.architecture?.input_modalities?.includes('image')"
                class="text-primary mr-0.5 h-2.5 w-2.5"
              />
            </div>
            <span
              class="text-muted-foreground truncate font-mono text-xs opacity-75"
            >
              {{ m.id }}
            </span>
            <div
              class="text-muted-foreground/80 mt-0.5 flex flex-wrap items-center gap-2 font-mono text-xs"
            >
              <span v-if="m.context_length">
                {{ Math.round(m.context_length / 1000) }}k ctx
              </span>
              <span v-if="m.pricing?.prompt">
                • ${{ (parseFloat(m.pricing.prompt) * 1000000).toFixed(2) }}/M
                in
              </span>
            </div>
          </div>
          <Check
            v-if="m.id === currentModelId"
            class="text-primary mt-1 h-4 w-4 shrink-0"
          />
        </button>

        <!-- Empty State -->
        <div
          v-if="filteredModels.length === 0 && !canUseCustomModel"
          class="text-muted-foreground py-6 text-center text-xs"
        >
          No models found matching "{{ searchQuery }}"
        </div>
      </div>

      <!-- Footer Bar: Counts & Refresh Trigger -->
      <div
        class="border-border/40 bg-muted/20 text-muted-foreground flex items-center justify-between border-t px-2.5 py-1.5 text-xs"
      >
        <span>{{ filteredModels.length }} models</span>
        <button
          type="button"
          :disabled="aiStore.isLoadingModels"
          class="hover:text-foreground flex cursor-pointer items-center gap-1 text-xs transition-colors disabled:opacity-50"
          title="Refresh model list from OpenRouter"
          @click="aiStore.refreshModels(true)"
        >
          <RefreshCw
            class="h-3 w-3"
            :class="{ 'animate-spin': aiStore.isLoadingModels }"
          />
          <span>Refresh</span>
        </button>
      </div>
    </PopoverContent>
  </Popover>
</template>
