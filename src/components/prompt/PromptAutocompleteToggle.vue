<script setup lang="ts">
import { Hash, WholeWord } from '@lucide/vue';
import { computed } from 'vue';
import { useLauncherStore } from '@/stores/launcherStore';
import { useWorkflowStore } from '@/stores/workflowStore';

const launcherStore = useLauncherStore();
const workflowStore = useWorkflowStore();

const isWordSource = computed(
  () =>
    launcherStore.config.promptAutocompleteSource[workflowStore.profile] ===
    'word'
);

function toggleSource() {
  void launcherStore
    .saveConfig({
      promptAutocompleteSource: {
        ...launcherStore.config.promptAutocompleteSource,
        [workflowStore.profile]: isWordSource.value ? 'tag' : 'word'
      }
    })
    .catch(console.error);
}
</script>
<template>
  <button
    type="button"
    class="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1 text-xs font-medium transition-colors"
    :title="
      isWordSource
        ? 'Autocomplete: English words. Click for booru tags'
        : 'Autocomplete: booru tags. Click for English words'
    "
    :aria-label="
      isWordSource
        ? 'Switch autocomplete to booru tags'
        : 'Switch autocomplete to English words'
    "
    @click="toggleSource"
  >
    <WholeWord v-if="isWordSource" class="h-3 w-3" />
    <Hash v-else class="h-3 w-3" />
    <span>{{ isWordSource ? 'Words' : 'Tags' }}</span>
  </button>
</template>
