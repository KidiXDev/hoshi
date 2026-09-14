<script setup lang="ts">
import { ref } from 'vue';
import {
  Check,
  Copy,
  Sparkles,
  Wand2,
  FileCode,
  ChevronUp,
  ChevronDown
} from '@lucide/vue';
import { Button } from '@/components/ui/button';
import type { CivitaiImage } from '@/services/civitai';

defineProps<{
  activeImage?: CivitaiImage;
  appliedToWorkflow: boolean;
  copiedKey: string | null;
}>();
const emit = defineEmits<{ apply: []; copy: [text: string, key: string] }>();
const showRawMeta = ref(false);
</script>
<template>
  <div
    v-if="activeImage?.meta && Object.keys(activeImage.meta).length > 0"
    class="border-border/70 bg-card/70 flex flex-col gap-3 rounded-xl border p-4 shadow-xs"
  >
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-1.5 text-xs font-semibold">
        <Sparkles class="text-primary h-3.5 w-3.5" />
        <span>Sample Generation Parameters</span>
      </div>

      <Button
        variant="outline"
        size="sm"
        class="border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 h-7 cursor-pointer gap-1.5 text-xs font-medium shadow-xs"
        @click="emit('apply')"
      >
        <Check v-if="appliedToWorkflow" class="h-3.5 w-3.5 text-emerald-500" />
        <Wand2 v-else class="h-3.5 w-3.5" />
        <span>{{
          appliedToWorkflow ? 'Applied to Workflow!' : 'Apply to Generator'
        }}</span>
      </Button>
    </div>

    <!-- Positive Prompt -->
    <div v-if="activeImage.meta.prompt" class="flex flex-col gap-1.5">
      <div
        class="text-muted-foreground flex items-center justify-between text-xs"
      >
        <span class="font-medium">Positive Prompt</span>
        <button
          type="button"
          class="hover:text-primary flex cursor-pointer items-center gap-1 text-xs font-medium transition-colors"
          @click="emit('copy', String(activeImage.meta.prompt), 'prompt')"
        >
          <Check
            v-if="copiedKey === 'prompt'"
            class="h-3 w-3 text-emerald-500"
          />
          <Copy v-else class="h-3 w-3" />
          <span>{{ copiedKey === 'prompt' ? 'Copied' : 'Copy Prompt' }}</span>
        </button>
      </div>
      <p
        class="bg-muted/60 border-border/40 max-h-28 overflow-y-auto rounded-lg border p-2.5 font-mono text-xs leading-relaxed select-text"
      >
        {{ activeImage.meta.prompt }}
      </p>
    </div>

    <!-- Negative Prompt -->
    <div v-if="activeImage.meta.negativePrompt" class="flex flex-col gap-1.5">
      <div
        class="text-muted-foreground flex items-center justify-between text-xs"
      >
        <span class="font-medium">Negative Prompt</span>
        <button
          type="button"
          class="hover:text-primary flex cursor-pointer items-center gap-1 text-xs font-medium transition-colors"
          @click="
            emit('copy', String(activeImage.meta.negativePrompt), 'negPrompt')
          "
        >
          <Check
            v-if="copiedKey === 'negPrompt'"
            class="h-3 w-3 text-emerald-500"
          />
          <Copy v-else class="h-3 w-3" />
          <span>{{
            copiedKey === 'negPrompt' ? 'Copied' : 'Copy Negative'
          }}</span>
        </button>
      </div>
      <p
        class="bg-muted/60 border-border/40 max-h-24 overflow-y-auto rounded-lg border p-2.5 font-mono text-xs leading-relaxed select-text"
      >
        {{ activeImage.meta.negativePrompt }}
      </p>
    </div>

    <!-- Technical Parameter Badges -->
    <div class="flex flex-wrap gap-1.5 pt-1">
      <span
        v-if="activeImage.meta.sampler"
        class="bg-muted/80 rounded-md px-2 py-0.5 font-mono text-xs"
      >
        Sampler: {{ activeImage.meta.sampler }}
      </span>
      <span
        v-if="activeImage.meta.steps"
        class="bg-muted/80 rounded-md px-2 py-0.5 font-mono text-xs"
      >
        Steps: {{ activeImage.meta.steps }}
      </span>
      <span
        v-if="activeImage.meta.cfgScale"
        class="bg-muted/80 rounded-md px-2 py-0.5 font-mono text-xs"
      >
        CFG: {{ activeImage.meta.cfgScale }}
      </span>
      <span
        v-if="activeImage.meta.seed"
        class="bg-muted/80 rounded-md px-2 py-0.5 font-mono text-xs"
      >
        Seed: {{ activeImage.meta.seed }}
      </span>
      <span
        v-if="activeImage.meta.Size"
        class="bg-muted/80 rounded-md px-2 py-0.5 font-mono text-xs"
      >
        Size: {{ activeImage.meta.Size }}
      </span>
      <span
        v-if="activeImage.meta.clipSkip"
        class="bg-muted/80 rounded-md px-2 py-0.5 font-mono text-xs"
      >
        Clip Skip: {{ activeImage.meta.clipSkip }}
      </span>
      <span
        v-if="activeImage.meta.Model"
        class="bg-muted/80 rounded-md px-2 py-0.5 font-mono text-xs"
      >
        Model: {{ activeImage.meta.Model }}
      </span>
    </div>

    <!-- Raw JSON Metadata Toggle -->
    <div class="border-border/60 border-t pt-2">
      <button
        type="button"
        class="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1 text-xs transition-colors"
        @click="showRawMeta = !showRawMeta"
      >
        <FileCode class="h-3.5 w-3.5" />
        <span>{{
          showRawMeta ? 'Hide Raw Metadata' : 'View Raw Metadata'
        }}</span>
        <ChevronUp v-if="showRawMeta" class="h-3 w-3" />
        <ChevronDown v-else class="h-3 w-3" />
      </button>

      <div v-if="showRawMeta" class="mt-2">
        <pre
          class="bg-muted/70 max-h-48 overflow-y-auto rounded-lg p-2.5 font-mono text-xs leading-tight select-text"
          >{{ JSON.stringify(activeImage.meta, null, 2) }}</pre>
      </div>
    </div>
  </div>
</template>
