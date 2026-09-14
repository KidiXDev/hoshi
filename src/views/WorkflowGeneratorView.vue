<script setup lang="ts">
import { Folder, History, Images, Loader2, Workflow } from '@lucide/vue';
import { useRouter } from 'vue-router';
import { toast } from 'vue-sonner';
import { useComfyUiWorkspace } from '@/composables/useComfyUiWorkspace';
import ModelSection from '@/components/template/ModelSection.vue';
import AdvancedSettingsSection from '@/components/template/AdvancedSettingsSection.vue';
import PromptSection from '@/components/template/PromptSection.vue';
import ImageInputSection from '@/components/template/ImageInputSection.vue';
import WDTaggerSection from '@/components/template/WDTaggerSection.vue';
import SamplerSection from '@/components/template/SamplerSection.vue';
import LoraChainSection from '@/components/template/LoraChainSection.vue';
import PostFxSection from '@/components/template/PostFxSection.vue';
import FaceDetailerSection from '@/components/template/FaceDetailerSection.vue';
import GenerationHistoryPanel from '@/components/template/GenerationHistoryPanel.vue';
import GenerationPreview from '@/components/template/GenerationPreview.vue';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '@/components/ui/resizable';
import { invoke } from '@tauri-apps/api/core';
import { useHistoryStore } from '../stores/historyStore';
import { useLauncherStore } from '../stores/launcherStore';
import { useWorkflowStore } from '../stores/workflowStore';

const workflowStore = useWorkflowStore();
const launcherStore = useLauncherStore();
const historyStore = useHistoryStore();
const router = useRouter();
const { pending, openSnapshot, finishSnapshot } = useComfyUiWorkspace();

async function viewWorkflow() {
  let requestId: string | undefined;
  try {
    openSnapshot(
      workflowStore.getFullWorkflowState(),
      launcherStore.config.serverUrl
    );
    requestId = pending.value?.id;
    const failure = await router.push('/comfyui');
    if (failure && pending.value) finishSnapshot(pending.value.id);
  } catch (error) {
    if (requestId) finishSnapshot(requestId);
    toast.error(error instanceof Error ? error.message : String(error));
  }
}

async function openOutputFolder() {
  const workingDir = launcherStore.config.workingDir.replace(/[\\/]+$/u, '');
  if (!workingDir) return;
  const path = /[\\/]comfyui$/iu.test(workingDir)
    ? `${workingDir}\\output`
    : `${workingDir}\\ComfyUI\\output`;
  try {
    await invoke('show_in_folder', { path });
  } catch (error) {
    console.error('Failed to open output folder:', error);
  }
}
</script>

<template>
  <div
    v-if="workflowStore.isLoaded"
    class="bg-background flex h-full flex-col overflow-hidden"
  >
    <!-- Top Studio Toolbar / Tab Strip -->
    <header
      class="border-border bg-card/60 flex h-10 shrink-0 items-center justify-between border-b px-4 backdrop-blur-xs select-none"
    >
      <!-- Left: Workspace Tab Strip -->
      <div class="flex items-center gap-2">
        <!-- Active Workspace Tab -->
        <div
          class="border-primary/30 bg-primary/10 text-primary inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-xs font-semibold shadow-xs"
        >
          <Images class="h-3 w-3" />
          <span>Generation Studio</span>
        </div>

        <!-- Session History Toggle Button -->
        <button
          type="button"
          title="Toggle Generation History Panel"
          class="border-border inline-flex h-6.5 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors"
          :class="
            historyStore.isPanelOpen
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground'
          "
          @click="historyStore.isPanelOpen = !historyStore.isPanelOpen"
        >
          <History class="h-3 w-3" />
          <span>History</span>
          <span
            v-if="historyStore.items.length > 0"
            class="bg-primary/20 text-primary rounded px-1 font-mono text-xs font-bold"
          >
            {{ historyStore.items.length }}
          </span>
        </button>

        <!-- Output Folder Quick Button -->
        <button
          type="button"
          title="Open the current workflow in ComfyUI"
          :disabled="!!pending"
          class="border-border bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground inline-flex h-6.5 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          @click="viewWorkflow"
        >
          <Workflow class="h-3 w-3" />
          <span>View Workflow</span>
        </button>

        <button
          type="button"
          title="Open Output Folder"
          class="border-border bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground inline-flex h-6.5 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors"
          @click="openOutputFolder"
        >
          <Folder class="h-3 w-3" />
          <span>Outputs</span>
        </button>
      </div>

      <!-- Right: Active Stats & Quick Meta -->
      <div class="flex items-center gap-3">
        <div class="flex items-center gap-1.5 font-mono text-xs">
          <span class="text-muted-foreground">Active LoRAs:</span>
          <span class="text-primary font-semibold">
            {{ workflowStore.loras.filter((l) => l.enabled).length }}/{{
              workflowStore.loras.length
            }}
          </span>
        </div>

        <div class="bg-border h-3 w-px" />

        <span class="text-muted-foreground font-mono text-xs">
          {{ workflowStore.models.unetName || 'No model selected' }}
        </span>
      </div>
    </header>

    <ResizablePanelGroup
      id="workflow-generator-group"
      :key="historyStore.isPanelOpen ? 'with-history' : 'without-history'"
      auto-save-id="workflow-generator-layout"
      direction="horizontal"
      class="min-h-0 w-full flex-1 gap-2 overflow-hidden p-3"
    >
      <ResizablePanel
        id="workflow-params-panel"
        :order="1"
        :default-size="historyStore.isPanelOpen ? 40 : 50"
        :min-size="25"
        :max-size="65"
        class="h-full min-h-0 min-w-0"
      >
        <div class="flex h-full flex-col gap-3 overflow-y-auto pr-2">
          <!-- Section Header -->
          <div class="flex items-center justify-between pt-0.5 pb-1">
            <h2 class="text-primary text-xs font-bold tracking-wider uppercase">
              Generation Parameters
            </h2>
            <span class="text-muted-foreground font-mono text-xs">
              Qwen-Image / Anima
            </span>
          </div>

          <!-- 1. Checkpoint & Model Architecture -->
          <section
            class="border-border bg-card hover:border-primary/40 flex flex-col gap-3 rounded-xl border p-3.5 shadow-2xs transition-colors"
          >
            <ModelSection />
          </section>

          <!-- Advanced Settings (AuraFlow Shift, CacheDiT, RenormCFG) -->
          <section
            class="border-border bg-card hover:border-primary/40 rounded-xl border p-1 shadow-2xs transition-colors"
          >
            <AdvancedSettingsSection />
          </section>

          <!-- 2. Prompts (Positive & Negative) -->
          <section
            class="border-border bg-card hover:border-primary/40 flex flex-col gap-3 rounded-xl border p-3.5 shadow-2xs transition-colors"
          >
            <PromptSection />
            <div class="border-border border-t pt-2">
              <ImageInputSection />
            </div>
          </section>

          <!-- 3. WD Tagger -->
          <section
            class="border-border bg-card hover:border-primary/40 flex flex-col gap-3 rounded-xl border p-3.5 shadow-2xs transition-colors"
          >
            <WDTaggerSection />
          </section>

          <!-- 4. Sampling & Canvas (including Seed & Variation) -->
          <section
            class="border-border bg-card hover:border-primary/40 flex flex-col gap-3 rounded-xl border p-3.5 shadow-2xs transition-colors"
          >
            <SamplerSection />
          </section>

          <!-- 5. LoRA Chain Stack -->
          <section
            class="border-border bg-card hover:border-primary/40 flex flex-col gap-3 rounded-xl border p-3.5 shadow-2xs transition-colors"
          >
            <LoraChainSection />
          </section>

          <!-- 7. Face Detailer -->
          <section
            class="border-border bg-card rounded-xl border p-3.5 shadow-2xs"
          >
            <FaceDetailerSection />
          </section>

          <!-- 8. PostFX & Upscaling -->
          <section
            class="border-border bg-card rounded-xl border p-1 shadow-2xs"
          >
            <PostFxSection />
          </section>
        </div>
      </ResizablePanel>

      <!-- Middle Resizable Divider Handle -->
      <ResizableHandle
        with-handle
        class="hover:bg-primary/50 transition-colors"
      />

      <!-- Middle Column: Preview Viewport Panel -->
      <ResizablePanel
        id="workflow-preview-panel"
        :order="2"
        :default-size="historyStore.isPanelOpen ? 47 : 50"
        :min-size="25"
        :max-size="75"
        class="h-full min-h-0 min-w-0"
      >
        <section
          class="border-border bg-card flex h-full min-h-0 w-full flex-col rounded-xl border p-3.5 shadow-2xs"
        >
          <GenerationPreview />
        </section>
      </ResizablePanel>

      <!-- History Resizable Divider Handle -->
      <ResizableHandle
        v-if="historyStore.isPanelOpen"
        with-handle
        class="hover:bg-primary/50 transition-colors"
      />

      <ResizablePanel
        v-if="historyStore.isPanelOpen"
        id="workflow-history-panel"
        :order="3"
        :default-size="13"
        :min-size="8"
        :max-size="25"
        class="h-full min-h-0 min-w-0"
      >
        <section
          class="border-border bg-card flex h-full min-h-0 w-full flex-col rounded-xl border p-3 shadow-2xs"
        >
          <GenerationHistoryPanel />
        </section>
      </ResizablePanel>
    </ResizablePanelGroup>
  </div>
  <div
    v-else
    class="bg-background text-muted-foreground flex h-full items-center justify-center"
    role="status"
    aria-live="polite"
  >
    <Loader2 class="text-primary h-5 w-5 animate-spin" />
    <span class="ml-2 text-xs">Loading workspace…</span>
  </div>
</template>
