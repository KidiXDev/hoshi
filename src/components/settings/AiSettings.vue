<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ExternalLink, Loader2, Sparkles, Trash2, Wifi } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useAiStore } from '@/stores/aiStore';
import AiModelSelector from '@/components/common/AiModelSelector.vue';
import AiReasoningSelector from '@/components/common/AiReasoningSelector.vue';
import SettingsSection from '@/components/layout/SettingsSection.vue';

const emit = defineEmits<{ saved: [] }>();
function showSaved() {
  emit('saved');
}
const aiStore = useAiStore();
const aiTemperature = computed<number[]>({
  get: () => [aiStore.config.temperature],
  set: ([value]) => {
    aiStore.config.temperature = value ?? 0.7;
  }
});
const aiContextMaximum = computed(() =>
  Math.max(8192, aiStore.selectedModelInfo?.context_length ?? 131072)
);
const aiContextTokens = computed<number[]>({
  get: () => [
    Math.min(aiStore.config.contextTokenLimit, aiContextMaximum.value)
  ],
  set: ([value]) => {
    aiStore.config.contextTokenLimit = value ?? 32768;
  }
});
const aiResponseTokens = computed<number[]>({
  get: () => [aiStore.config.maxOutputTokens],
  set: ([value]) => {
    aiStore.config.maxOutputTokens = value ?? 4096;
  }
});
const openRouterApiKey = ref('');
const savedOpenRouterApiKey = ref('');
const hasOpenRouterApiKey = ref(false);
const isTestingAi = ref(false);
const aiTestResult = ref<{ ok: boolean; message: string } | null>(null);
function loadAiSettings() {
  const key = aiStore.config.apiKey.trim();
  savedOpenRouterApiKey.value = key;
  hasOpenRouterApiKey.value = !!key;
  openRouterApiKey.value = '';
}
function clearOpenRouterApiKey() {
  savedOpenRouterApiKey.value = '';
  openRouterApiKey.value = '';
  hasOpenRouterApiKey.value = false;
  aiStore.config.apiKey = '';
  void aiStore.saveConfig();
  showSaved();
}
const autosaveAiSettings = useDebounceFn(() => {
  const newKey = openRouterApiKey.value.trim();
  if (newKey) {
    aiStore.config.apiKey = newKey;
    savedOpenRouterApiKey.value = newKey;
    hasOpenRouterApiKey.value = true;
    openRouterApiKey.value = '';
  }
  void aiStore.saveConfig();
  showSaved();
}, 300);
async function testOpenRouterConnection() {
  const key = openRouterApiKey.value.trim() || savedOpenRouterApiKey.value;
  if (!key) {
    aiTestResult.value = {
      ok: false,
      message: 'Please enter an API key first'
    };
    return;
  }
  isTestingAi.value = true;
  aiTestResult.value = null;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${key}` }
    });
    if (res.ok) {
      const data = (await res.json()) as {
        data?: { label?: string; usage?: number; limit?: number };
      };
      aiTestResult.value = {
        ok: true,
        message: `Connected! ${data?.data?.label ? `(${data.data.label})` : 'Key is valid'}`
      };
      if (openRouterApiKey.value.trim()) {
        aiStore.config.apiKey = openRouterApiKey.value.trim();
        savedOpenRouterApiKey.value = openRouterApiKey.value.trim();
        hasOpenRouterApiKey.value = true;
        openRouterApiKey.value = '';
        void aiStore.saveConfig();
      }
      void aiStore.refreshModels(true);
    } else {
      aiTestResult.value = {
        ok: false,
        message: `Authentication failed: HTTP ${res.status}`
      };
    }
  } catch (err) {
    aiTestResult.value = { ok: false, message: String(err) };
  } finally {
    isTestingAi.value = false;
  }
}
watch(
  () => aiStore.config.apiKey,
  (val) => {
    savedOpenRouterApiKey.value = val;
    hasOpenRouterApiKey.value = !!val;
  }
);
function saveAiTuning() {
  void aiStore.saveConfig();
  showSaved();
}
onMounted(loadAiSettings);
</script>
<template>
  <SettingsSection title="AI Assistant (OpenRouter)">
    <template #icon>
      <Sparkles class="h-3.5 w-3.5" />
    </template>
    <template #actions>
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="text-xs"
        @click="openUrl('https://openrouter.ai/settings/keys')"
      >
        <ExternalLink class="h-3.5 w-3.5" />
        Get OpenRouter Key
      </Button>
    </template>

    <!-- OpenRouter API Key Input -->
    <Field class="gap-1.5">
      <div class="flex items-center justify-between">
        <FieldLabel class="text-xs">OpenRouter API Key</FieldLabel>
        <button
          type="button"
          :disabled="isTestingAi || (!openRouterApiKey && !hasOpenRouterApiKey)"
          class="text-primary flex cursor-pointer items-center gap-1 text-xs hover:underline disabled:cursor-not-allowed disabled:opacity-50"
          @click="testOpenRouterConnection"
        >
          <Loader2 v-if="isTestingAi" class="h-3 w-3 animate-spin" />
          <Wifi v-else class="h-3 w-3" />
          <span>Test Connection</span>
        </button>
      </div>
      <div class="relative">
        <Input
          v-model="openRouterApiKey"
          type="password"
          autocomplete="new-password"
          :placeholder="
            hasOpenRouterApiKey ? 'Saved' : 'Enter OpenRouter API key'
          "
          class="pr-10 font-mono text-xs"
          @keydown.enter="autosaveAiSettings.flush()"
          @blur="autosaveAiSettings.flush()"
        />
        <button
          v-if="hasOpenRouterApiKey && !openRouterApiKey"
          type="button"
          class="text-muted-foreground hover:text-destructive absolute top-1/2 right-2.5 -translate-y-1/2 p-1 transition-colors"
          title="Remove saved OpenRouter API key"
          @click="clearOpenRouterApiKey"
        >
          <Trash2 class="h-3.5 w-3.5" />
        </button>
      </div>
      <div
        v-if="aiTestResult"
        class="text-xs"
        :class="aiTestResult.ok ? 'text-emerald-500' : 'text-destructive'"
      >
        {{ aiTestResult.message }}
      </div>
    </Field>

    <!-- Default Model Selector with Search -->
    <Field class="gap-1.5">
      <FieldLabel class="text-xs">Default Model</FieldLabel>
      <AiModelSelector
        :model-value="aiStore.config.selectedModel"
        @change="
          (val) => {
            aiStore.config.selectedModel = val;
            void aiStore.saveConfig();
            showSaved();
          }
        "
      />
    </Field>

    <AiReasoningSelector />

    <!-- Chat Title Model -->
    <Field class="gap-1.5">
      <FieldLabel class="text-xs">Chat Title Model</FieldLabel>
      <div class="flex items-center gap-1.5">
        <AiModelSelector
          :model-value="aiStore.config.titleModel ?? ''"
          placeholder="Same as default model"
          @change="
            (val) => {
              aiStore.config.titleModel = val;
              void aiStore.saveConfig();
              showSaved();
            }
          "
        />
        <Button
          v-if="aiStore.config.titleModel"
          variant="ghost"
          size="icon"
          class="h-8 w-8 shrink-0"
          title="Use default model for titles"
          @click="
            () => {
              aiStore.config.titleModel = '';
              void aiStore.saveConfig();
              showSaved();
            }
          "
        >
          <Trash2 class="h-3.5 w-3.5" />
        </Button>
      </div>
      <p class="text-muted-foreground text-xs">
        Used to auto-name a chat after its first message.
      </p>
    </Field>

    <div class="border-border/60 bg-muted/20 grid gap-4 rounded-lg border p-3">
      <Field class="gap-2">
        <div class="flex items-center justify-between">
          <FieldLabel class="text-xs">Temperature</FieldLabel>
          <span class="text-primary font-mono text-xs">
            {{ aiStore.config.temperature.toFixed(1) }}
          </span>
        </div>
        <Slider
          v-model="aiTemperature"
          :min="0"
          :max="2"
          :step="0.1"
          aria-label="AI temperature"
          @value-commit="saveAiTuning"
        />
      </Field>

      <Field class="gap-2">
        <div class="flex items-center justify-between">
          <FieldLabel class="text-xs">Chat Context Tokens</FieldLabel>
          <span class="text-primary font-mono text-xs">
            {{ aiContextTokens[0]?.toLocaleString() }}
          </span>
        </div>
        <Slider
          v-model="aiContextTokens"
          :min="2048"
          :max="aiContextMaximum"
          :step="1024"
          aria-label="Chat context token budget"
          @value-commit="saveAiTuning"
        />
        <p class="text-muted-foreground text-xs">
          Approximate history budget, capped by the selected model.
        </p>
      </Field>

      <Field class="gap-2">
        <div class="flex items-center justify-between">
          <FieldLabel class="text-xs">Response Tokens</FieldLabel>
          <span class="text-primary font-mono text-xs">
            {{ aiStore.config.maxOutputTokens.toLocaleString() }}
          </span>
        </div>
        <Slider
          v-model="aiResponseTokens"
          :min="512"
          :max="16384"
          :step="512"
          aria-label="Maximum AI response tokens"
          @value-commit="saveAiTuning"
        />
      </Field>
    </div>

    <!-- Provider Routing Override (Custom Provider) -->
    <Field class="gap-1.5">
      <FieldLabel class="text-xs">
        Provider Override (Custom Provider)
      </FieldLabel>
      <Input
        v-model="aiStore.config.providerOverride"
        placeholder="Enter your provider"
        class="h-8 font-mono text-xs"
        @change="
          () => {
            void aiStore.saveConfig();
            showSaved();
          }
        "
      />
    </Field>

    <!-- Allow Provider Fallbacks -->
    <div
      class="border-border/60 bg-muted/20 flex items-center justify-between rounded-lg border p-3"
    >
      <Label
        for="ai-provider-fallbacks-switch"
        class="text-foreground flex cursor-pointer items-center text-xs font-medium"
      >
        Allow Provider Fallbacks
      </Label>
      <Switch
        id="ai-provider-fallbacks-switch"
        :checked="aiStore.config.allowProviderFallbacks ?? true"
        @update:checked="
          (val: boolean) => {
            aiStore.config.allowProviderFallbacks = val;
            void aiStore.saveConfig();
            showSaved();
          }
        "
      />
    </div>

    <!-- Auto-Apply Toggle Setting -->
    <div
      class="border-border/60 bg-muted/20 flex items-center justify-between rounded-lg border p-3"
    >
      <Label
        for="ai-auto-apply-switch"
        class="text-foreground flex cursor-pointer items-center text-xs font-medium"
      >
        Auto-Apply Agentic Actions
      </Label>
      <Switch
        id="ai-auto-apply-switch"
        :model-value="aiStore.config.autoApply"
        @update:model-value="
          (val: boolean) => {
            aiStore.config.autoApply = val;
            void aiStore.saveConfig();
            showSaved();
          }
        "
      />
    </div>

    <!-- Chatbot Assistant Custom Instructions -->
    <Field class="gap-1.5">
      <FieldLabel class="text-xs">
        Chatbot Assistant Instructions (Optional)
      </FieldLabel>
      <Textarea
        :model-value="aiStore.config.customSystemPrompt"
        rows="3"
        placeholder="Enter custom instructions..."
        class="max-h-96 min-h-32 resize-y font-mono text-xs leading-relaxed"
        @update:model-value="
          (val) => {
            aiStore.config.customSystemPrompt = String(val);
            void aiStore.saveConfig();
          }
        "
      />
    </Field>

    <!-- Prompt Enhancer Custom Instructions -->
    <Field class="gap-1.5">
      <div class="flex items-center justify-between gap-3">
        <FieldLabel class="text-xs">
          Prompt Enhancer Instructions (Optional)
        </FieldLabel>
        <Label
          for="enhancer-use-assistant-instruction"
          class="flex cursor-pointer items-center gap-2 text-xs"
        >
          Use assistant instruction
          <Switch
            id="enhancer-use-assistant-instruction"
            :model-value="aiStore.config.enhancerUsesAssistantInstruction"
            @update:model-value="
              (val: boolean) => {
                aiStore.config.enhancerUsesAssistantInstruction = val;
                void aiStore.saveConfig();
                showSaved();
              }
            "
          />
        </Label>
      </div>
      <Textarea
        :model-value="aiStore.config.enhancerSystemPrompt"
        :disabled="aiStore.config.enhancerUsesAssistantInstruction"
        rows="3"
        :placeholder="
          aiStore.config.enhancerUsesAssistantInstruction
            ? 'Using assistant instructions'
            : 'Enter custom guidelines...'
        "
        class="max-h-96 min-h-24 resize-y font-mono text-xs leading-relaxed"
        @update:model-value="
          (val) => {
            aiStore.config.enhancerSystemPrompt = String(val);
            void aiStore.saveConfig();
          }
        "
      />
    </Field>
  </SettingsSection>
</template>
