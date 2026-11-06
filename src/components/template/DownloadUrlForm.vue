<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import { Download, Loader2 } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  fileNameFromUrl,
  normalizeDownloadUrl
} from '@/services/downloadManager';
import { MODEL_CATEGORY_LABELS } from '@/services/modelManager';
import { useDownloadStore } from '@/stores/downloadStore';

const emit = defineEmits<{ queued: [] }>();

const categories = Object.entries(MODEL_CATEGORY_LABELS);

const downloadStore = useDownloadStore();
const url = shallowRef('');
const category = shallowRef('checkpoints');
const fileName = shallowRef('');
const isSubmitting = shallowRef(false);

const normalizedUrl = computed(() => normalizeDownloadUrl(url.value));
const canSubmit = computed(
  () =>
    Boolean(normalizedUrl.value && fileName.value.trim()) && !isSubmitting.value
);

watch(normalizedUrl, (value) => {
  fileName.value = fileNameFromUrl(value);
});

async function submit() {
  if (!canSubmit.value) return;
  isSubmitting.value = true;
  try {
    await downloadStore.enqueueUrl({
      url: normalizedUrl.value,
      category: category.value,
      fileName: fileName.value
    });
    downloadStore.errorMessage = '';
    url.value = '';
    emit('queued');
  } catch (error) {
    downloadStore.errorMessage =
      error instanceof Error ? error.message : String(error);
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <form class="flex flex-col gap-3 p-4" @submit.prevent="submit">
    <div class="flex flex-col gap-1.5">
      <Label for="download-url" class="text-xs font-medium"
        >Download link</Label
      >
      <Input
        id="download-url"
        v-model="url"
        type="url"
        placeholder="https://huggingface.co/.../model.safetensors"
        class="font-mono text-xs"
      />
    </div>

    <div class="flex flex-col gap-1.5">
      <Label class="text-xs font-medium">Target folder</Label>
      <Select v-model="category">
        <SelectTrigger class="w-full text-xs" aria-label="Target folder">
          <SelectValue placeholder="Select folder..." />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup class="max-h-40 overflow-y-auto">
            <SelectItem
              v-for="[value, label] in categories"
              :key="value"
              :value="value"
              class="text-xs"
            >
              {{ label }}
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>

    <div class="flex flex-col gap-1.5">
      <Label for="download-file-name" class="text-xs font-medium">
        File name
      </Label>
      <Input
        id="download-file-name"
        v-model="fileName"
        placeholder="model.safetensors"
        class="font-mono text-xs"
      />
    </div>

    <Button type="submit" size="sm" class="text-xs" :disabled="!canSubmit">
      <Loader2 v-if="isSubmitting" class="h-3.5 w-3.5 animate-spin" />
      <Download v-else class="h-3.5 w-3.5" />
      <span>Download</span>
    </Button>
  </form>
</template>
