<script setup lang="ts">
import AssistantMessage from '@/components/ai/AssistantMessage.vue';
import AiMentionChip from '@/components/ai/AiMentionChip.vue';
import ImageLightboxModal from '@/components/common/ImageLightboxModal.vue';
import { formatRelativeTime } from '@/utils/formatters';
import mayaMascot from '@/assets/maya-mascot.png';
import { computed, nextTick, ref, shallowRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  ArrowUpRight,
  Check,
  ChevronLeft,
  Clock,
  History,
  ImagePlus,
  MessageSquare,
  Pencil,
  Plus,
  ScanEye,
  Search,
  Send,
  Settings,
  Square,
  Trash2,
  X,
  Zap
} from '@lucide/vue';
import { Button } from '@/components/ui/button';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerViewport
} from '@/components/ui/message-scroller';
import { provideMessageScroller } from '@/components/ui/message-scroller/useMessageScroller';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { useAiStore } from '../../stores/aiStore';
import { useComfyStore } from '../../stores/comfyStore';
import type { ChatMessage, ChatMessageAttachment } from '../../types/ai';
import { supportsVision } from '@/utils/aiMentions';
import AiModelSelector from '@/components/common/AiModelSelector.vue';
import AiReasoningSelector from '@/components/common/AiReasoningSelector.vue';
import { useOverlayLayer } from '@/composables/useOverlayLayer';
import { useConfirmDialog } from '@/composables/useConfirmDialog';

const aiStore = useAiStore();
const comfyStore = useComfyStore();
const router = useRouter();

const messageInput = ref('');
const attachments = ref<ChatMessageAttachment[]>([]);
const lightboxImage = shallowRef<{ src: string; title?: string } | null>(null);
const { context: messageScroll } = provideMessageScroller({ autoScroll: true });
const fileInputRef = ref<HTMLInputElement | null>(null);
const isDraggingOver = ref(false);
const visionSupported = computed(() =>
  supportsVision(aiStore.selectedModelInfo)
);
const { style: overlayStyle } = useOverlayLayer(() => aiStore.isDrawerOpen);
const { confirm } = useConfirmDialog();

const activeSession = computed(() => aiStore.activeSession);
const messages = computed(() => aiStore.activeMessages);

const showSessionsList = ref(false);
const sessionSearchQuery = ref('');
const editingSessionId = ref<string | null>(null);
const editingTitle = ref('');
const deletingSessionId = ref<string | null>(null);
const editingMessageId = ref<string | null>(null);
const editingMessageText = ref('');

const filteredSessions = computed(() => {
  const list = [...aiStore.sessions].sort(
    (a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)
  );
  const q = sessionSearchQuery.value.trim().toLowerCase();
  if (!q) return list;
  return list.filter((s) => s.title.toLowerCase().includes(q));
});

function handleNewChat() {
  aiStore.createSession('New Chat');
  showSessionsList.value = false;
}

function handleSelectSessionAndClose(sessionId: string) {
  aiStore.switchSession(sessionId);
  showSessionsList.value = false;
}

function startRename(s: { id: string; title: string }) {
  editingSessionId.value = s.id;
  editingTitle.value = s.title;
  nextTick(() => {
    const input = document.querySelector<HTMLInputElement>(
      `#rename-input-${s.id}`
    );
    input?.focus();
    input?.select();
  });
}

function saveRename(sessionId: string) {
  if (editingTitle.value.trim()) {
    aiStore.renameSession(sessionId, editingTitle.value.trim());
  }
  editingSessionId.value = null;
  editingTitle.value = '';
}

function cancelRename() {
  editingSessionId.value = null;
  editingTitle.value = '';
}

function promptDeleteSession(sessionId: string) {
  deletingSessionId.value = sessionId;
}

function confirmDeleteSession(sessionId: string) {
  aiStore.deleteSession(sessionId);
  deletingSessionId.value = null;
}

function cancelDeleteSession() {
  deletingSessionId.value = null;
}

async function handleClearAllSessions() {
  if (
    await confirm({
      title: 'Clear all conversations?',
      description: 'This permanently deletes every assistant conversation.',
      confirmLabel: 'Clear all'
    })
  ) {
    aiStore.clearAllSessions();
    sessionSearchQuery.value = '';
  }
}

function startMessageEdit(message: ChatMessage) {
  editingMessageId.value = message.id;
  editingMessageText.value = message.content;
}

function cancelMessageEdit() {
  editingMessageId.value = null;
  editingMessageText.value = '';
}

async function saveMessageEdit(messageId: string) {
  const content = editingMessageText.value.trim();
  if (!content) return;
  try {
    await aiStore.editMessageAndRegenerate(messageId, content);
    cancelMessageEdit();
  } catch (error) {
    console.error('Failed to edit message:', error);
  }
}

function handleModelChange(modelId: unknown) {
  if (typeof modelId === 'string') {
    aiStore.config.selectedModel = modelId;
    void aiStore.saveConfig();
  }
}

function handleAutoApplyChange(checked: boolean) {
  aiStore.config.autoApply = checked;
  void aiStore.saveConfig();
}

// Vision Attachment Helpers
function openFilePicker() {
  fileInputRef.value?.click();
}

async function handleFileChange(event: Event) {
  const target = event.target as HTMLInputElement;
  if (!target.files?.length) return;
  const files = Array.from(target.files);
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      await processImageFile(file);
    }
  }
  target.value = '';
}

function processImageFile(file: File): Promise<void> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      attachments.value.push({
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name,
        type: file.type,
        dataUrl: reader.result as string
      });
      resolve();
    };
    reader.readAsDataURL(file);
  });
}

function removeAttachment(id: string) {
  attachments.value = attachments.value.filter((a) => a.id !== id);
}

function openChatImage(src: string, title?: string) {
  lightboxImage.value = { src, title };
}

function closeChatImage(open: boolean) {
  if (!open) lightboxImage.value = null;
}

// Attach current preview or last generated image from studio
async function attachCurrentPreview() {
  const previewUrl =
    comfyStore.lastGeneratedImage?.url || comfyStore.currentPreviewUrl;
  if (!previewUrl) return;

  try {
    const res = await fetch(previewUrl);
    const blob = await res.blob();
    const reader = new FileReader();
    reader.onload = () => {
      attachments.value.push({
        id: `preview-${Date.now()}`,
        name: 'comfyui_preview.png',
        type: blob.type || 'image/png',
        dataUrl: reader.result as string
      });
    };
    reader.readAsDataURL(blob);
  } catch (err) {
    console.error('Failed to attach current preview image:', err);
  }
}

// Clipboard Paste (Ctrl+V) handler
async function handlePaste(event: ClipboardEvent) {
  const items = event.clipboardData?.items;
  if (!items) return;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type.indexOf('image') !== -1) {
      const file = item.getAsFile();
      if (file) {
        event.preventDefault();
        await processImageFile(file);
      }
    }
  }
}

// Drag & Drop
function handleDrop(event: DragEvent) {
  isDraggingOver.value = false;
  const files = event.dataTransfer?.files;
  if (!files?.length) return;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file.type.startsWith('image/')) {
      void processImageFile(file);
    }
  }
}

watch(
  [() => aiStore.activeSessionId, () => aiStore.isDrawerOpen, showSessionsList],
  () => {
    if (aiStore.isDrawerOpen && !showSessionsList.value)
      messageScroll.scrollToEnd();
  },
  { flush: 'post' }
);

async function handleSend() {
  const text = messageInput.value.trim();
  const currentAtts = [...attachments.value];
  const currentMentions = [...aiStore.draftMentions];
  if (!text && currentAtts.length === 0 && currentMentions.length === 0) return;
  if (aiStore.isGenerating) return;

  messageInput.value = '';
  attachments.value = [];
  aiStore.clearDraftMentions();
  nextTick(() => messageScroll.scrollToEnd());

  try {
    await aiStore.sendMessage(text, currentAtts, currentMentions);
  } catch (err) {
    console.error('Error sending message:', err);
  }
}

function handleStarterClick(promptText: string) {
  messageInput.value = promptText;
  void handleSend();
}

function navigateToSettings() {
  aiStore.isDrawerOpen = false;
  router.push('/settings');
}
</script>

<template>
  <div>
    <!-- Backdrop Overlay (allows clicking to dismiss) -->
    <div
      v-if="aiStore.isDrawerOpen"
      class="absolute inset-0 z-50 bg-black/40 backdrop-blur-xs transition-opacity duration-300"
      :style="overlayStyle"
      @click="aiStore.isDrawerOpen = false"
    />

    <!-- Slide-over Drawer -->
    <aside
      class="border-border bg-sidebar absolute top-0 right-0 z-50 flex h-full w-full max-w-md flex-col border-l shadow-2xl transition-transform duration-300 ease-in-out select-none sm:max-w-lg md:max-w-2xl"
      :style="overlayStyle"
      :class="aiStore.isDrawerOpen ? 'translate-x-0' : 'translate-x-full'"
      :inert="!aiStore.isDrawerOpen"
      :aria-hidden="!aiStore.isDrawerOpen"
    >
      <!-- Hidden File Input for Image Attachments -->
      <input
        ref="fileInputRef"
        type="file"
        accept="image/*"
        multiple
        class="hidden"
        @change="handleFileChange"
      />

      <!-- Drawer Header -->
      <div
        class="border-border bg-card/60 flex flex-col border-b px-3.5 py-2.5 backdrop-blur-xs"
      >
        <!-- Top row: App title, Session history button, New chat, Close -->
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <img
              :src="mayaMascot"
              alt="Maya"
              class="border-primary/30 bg-primary/10 h-8 w-8 rounded-lg border object-contain"
            />
            <span
              class="text-foreground text-sm font-bold tracking-wide uppercase"
            >
              Maya
            </span>
          </div>

          <div class="flex items-center gap-1.5">
            <!-- Session History View Toggle Button -->
            <Button
              :variant="showSessionsList ? 'secondary' : 'outline'"
              size="sm"
              class="h-7 max-w-44 gap-1.5 px-2 text-xs font-medium"
              :class="{
                'border-primary/50 text-primary bg-primary/10': showSessionsList
              }"
              title="View all chat sessions"
              @click="showSessionsList = !showSessionsList"
            >
              <History class="h-3.5 w-3.5 shrink-0" />
              <span class="truncate">{{
                activeSession?.title || 'Conversations'
              }}</span>
              <span
                class="bg-muted text-muted-foreground ml-0.5 rounded-full px-1.5 py-0.5 font-mono text-xs"
              >
                {{ aiStore.sessions.length }}
              </span>
            </Button>

            <!-- New Chat Button -->
            <Button
              variant="outline"
              size="sm"
              class="h-7 gap-1 px-2 text-xs"
              title="Start a new conversation"
              @click="handleNewChat"
            >
              <Plus class="h-3 w-3" />
              <span>New</span>
            </Button>

            <!-- Close Drawer Button -->
            <Button
              variant="ghost"
              size="icon-sm"
              class="text-muted-foreground hover:text-foreground h-7 w-7"
              title="Close drawer"
              @click="aiStore.isDrawerOpen = false"
            >
              <X class="h-4 w-4" />
            </Button>
          </div>
        </div>

        <!-- Subheader when in Sessions View -->
        <div
          v-if="showSessionsList"
          class="border-border/40 mt-2.5 flex items-center justify-between gap-2 border-t pt-2 text-xs"
        >
          <Button
            variant="ghost"
            size="sm"
            class="text-muted-foreground hover:text-foreground h-7 gap-1 px-2 text-xs"
            @click="showSessionsList = false"
          >
            <ChevronLeft class="h-3.5 w-3.5" />
            <span>Back to Chat</span>
          </Button>

          <span class="text-muted-foreground font-mono text-xs">
            {{ filteredSessions.length }} conversation{{
              filteredSessions.length === 1 ? '' : 's'
            }}
          </span>
        </div>

        <!-- Subheader when in Chat View: Auto-Apply Toggle -->
        <div
          v-else
          class="border-border/40 mt-2.5 flex items-center justify-between gap-2 border-t pt-1.5 text-xs"
        >
          <span class="text-muted-foreground truncate font-mono text-xs">
            {{ activeSession?.title || 'Current Chat' }}
          </span>

          <!-- Auto-Apply Toggle -->
          <div class="flex shrink-0 items-center gap-1.5 pl-1">
            <Tooltip>
              <TooltipTrigger as-child>
                <div class="flex cursor-pointer items-center gap-1.5">
                  <span class="text-muted-foreground text-xs">Auto-Apply</span>
                  <Switch
                    :model-value="aiStore.config.autoApply"
                    aria-label="Auto-Apply"
                    class="scale-75"
                    @update:model-value="handleAutoApplyChange"
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p class="text-xs">
                  When enabled, AI prompt injection & queue actions run without
                  confirmation cards.
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      <!-- SESSIONS MANAGEMENT VIEW -->
      <div
        v-if="showSessionsList"
        class="bg-sidebar/50 flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden p-3"
      >
        <!-- Search Input -->
        <div class="flex items-center gap-2">
          <div class="relative flex-1">
            <Search
              class="text-muted-foreground absolute top-2.5 left-2.5 h-3.5 w-3.5"
            />
            <input
              v-model="sessionSearchQuery"
              type="text"
              placeholder="Search conversations..."
              class="bg-background border-border placeholder:text-muted-foreground text-foreground focus:border-primary/60 h-8 w-full rounded-lg border pr-7 pl-8 text-xs transition-colors outline-none"
            />
            <button
              v-if="sessionSearchQuery"
              type="button"
              class="text-muted-foreground hover:text-foreground absolute top-2 right-2 flex h-4 w-4 items-center justify-center rounded-full"
              @click="sessionSearchQuery = ''"
            >
              <X class="h-3 w-3" />
            </button>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            :disabled="aiStore.sessions.length === 0"
            class="text-muted-foreground hover:text-destructive shrink-0"
            title="Clear all conversations"
            @click="handleClearAllSessions"
          >
            <Trash2 class="h-3.5 w-3.5" />
          </Button>
        </div>

        <!-- Sessions Scroll List -->
        <div class="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
          <div
            v-if="filteredSessions.length === 0"
            class="text-muted-foreground flex flex-col items-center justify-center gap-2 py-16 text-center"
          >
            <MessageSquare class="h-8 w-8 stroke-1 opacity-40" />
            <p class="text-xs">No conversations found</p>
            <Button
              v-if="sessionSearchQuery"
              variant="outline"
              size="sm"
              class="mt-1 h-7 text-xs"
              @click="sessionSearchQuery = ''"
            >
              Clear Search
            </Button>
            <Button
              v-else
              variant="outline"
              size="sm"
              class="mt-1 h-7 text-xs"
              @click="handleNewChat"
            >
              Create New Chat
            </Button>
          </div>

          <div
            v-for="s in filteredSessions"
            :key="s.id"
            class="group relative flex cursor-pointer flex-col gap-2 rounded-xl border p-3 text-left transition-all"
            :class="[
              s.id === aiStore.activeSessionId
                ? 'bg-primary/5 border-primary/40 ring-primary/30 shadow-xs ring-1'
                : 'bg-card/70 border-border/70 hover:bg-card hover:border-border'
            ]"
            @click="handleSelectSessionAndClose(s.id)"
          >
            <!-- Title Row or Inline Rename Form -->
            <div
              v-if="editingSessionId === s.id"
              class="flex items-center gap-1.5"
              @click.stop
            >
              <input
                :id="`rename-input-${s.id}`"
                v-model="editingTitle"
                type="text"
                class="bg-background border-primary text-foreground h-7 flex-1 rounded-md border px-2 text-xs font-medium shadow-xs outline-none"
                placeholder="Conversation title..."
                @keydown.enter.prevent="saveRename(s.id)"
                @keydown.esc.prevent="cancelRename"
              />
              <Button
                type="button"
                size="icon-sm"
                class="h-7 w-7 shrink-0 bg-emerald-600 text-white hover:bg-emerald-500"
                title="Save title (Enter)"
                @click="saveRename(s.id)"
              >
                <Check class="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                class="text-muted-foreground hover:text-foreground h-7 w-7 shrink-0"
                title="Cancel (Esc)"
                @click="cancelRename"
              >
                <X class="h-3.5 w-3.5" />
              </Button>
            </div>

            <div v-else class="flex items-center justify-between gap-2">
              <div class="flex min-w-0 flex-1 items-center gap-2">
                <span
                  class="text-foreground cursor-pointer truncate text-sm font-semibold hover:underline"
                  :title="s.title"
                  @dblclick.stop="startRename(s)"
                >
                  {{ s.title }}
                </span>
                <span
                  v-if="s.id === aiStore.activeSessionId"
                  class="border-primary/30 bg-primary/10 text-primary shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-xs font-medium"
                >
                  Active
                </span>
              </div>

              <!-- Action Buttons -->
              <div
                class="flex items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100"
                @click.stop
              >
                <button
                  type="button"
                  class="text-muted-foreground hover:text-foreground hover:bg-accent flex h-6 w-6 items-center justify-center rounded p-0.5 transition-colors"
                  title="Rename title (or double click title)"
                  @click="startRename(s)"
                >
                  <Pencil class="h-3 w-3" />
                </button>
                <button
                  type="button"
                  class="text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex h-6 w-6 items-center justify-center rounded p-0.5 transition-colors"
                  title="Delete conversation"
                  @click="promptDeleteSession(s.id)"
                >
                  <Trash2 class="h-3 w-3" />
                </button>
              </div>
            </div>

            <!-- Delete Confirmation Overlay / Row -->
            <div
              v-if="deletingSessionId === s.id"
              class="border-destructive/30 bg-destructive/10 flex items-center justify-between gap-2 rounded-lg border p-2 text-xs"
              @click.stop
            >
              <span class="text-destructive text-xs font-medium">
                Delete this conversation?
              </span>
              <div class="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  class="h-6 px-2 text-xs"
                  @click="cancelDeleteSession"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  class="h-6 px-2 text-xs"
                  @click="confirmDeleteSession(s.id)"
                >
                  Delete
                </Button>
              </div>
            </div>

            <!-- Meta info: Time & Messages -->
            <div
              v-if="deletingSessionId !== s.id"
              class="text-muted-foreground flex items-center justify-between pt-0.5 text-xs"
            >
              <span class="flex items-center gap-1 font-mono">
                <Clock class="h-3 w-3" />
                {{ formatRelativeTime(s.updatedAt || s.createdAt) }}
              </span>
              <span class="flex items-center gap-1">
                <MessageSquare class="h-3 w-3" />
                {{ s.messages.length }} message{{
                  s.messages.length === 1 ? '' : 's'
                }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- ACTIVE CONVERSATION VIEW -->
      <template v-else>
        <!-- Api Key Banner if not set -->
        <div
          v-if="!aiStore.hasApiKey"
          class="m-3 flex flex-col gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs"
        >
          <div class="flex items-center gap-2 font-semibold text-amber-500">
            <Zap class="h-4 w-4" />
            <span>OpenRouter API Key Required</span>
          </div>
          <p class="text-muted-foreground">
            Configure your OpenRouter API key to enable prompt generation, AI
            vision analysis, and agentic studio control.
          </p>
          <Button
            size="sm"
            variant="secondary"
            class="h-7 w-fit gap-1.5 text-xs"
            @click="navigateToSettings"
          >
            <Settings class="h-3.5 w-3.5" />
            <span>Open Settings</span>
          </Button>
        </div>

        <!-- Messages Thread -->
        <MessageScroller class="h-auto flex-1">
          <MessageScrollerViewport class="p-3.5 select-text">
            <MessageScrollerContent class="gap-3.5">
              <!-- Empty State with Starters -->
              <div
                v-if="messages.length === 0"
                class="my-auto flex h-full flex-col items-center justify-center gap-3 p-4 text-center"
              >
                <img
                  :src="mayaMascot"
                  alt="Maya"
                  class="bg-primary/10 border-primary/20 h-20 w-20 rounded-2xl border object-contain shadow-xs"
                />
                <div class="flex flex-col gap-1">
                  <h3 class="text-foreground text-sm font-semibold">Maya</h3>
                  <p class="text-muted-foreground max-w-sm text-sm">
                    Ask Maya to brainstorm Anima prompts, detail anime character
                    outfits, analyze image styles with Vision, or inspect and
                    queue renders.
                  </p>
                </div>

                <!-- Starter Chips -->
                <div class="flex w-full max-w-xs flex-col gap-1.5 pt-2">
                  <button
                    type="button"
                    class="border-border bg-card/60 hover:bg-accent hover:border-primary/40 text-foreground flex cursor-pointer items-center justify-between rounded-lg border p-2.5 text-left text-sm transition-colors"
                    @click="
                      handleStarterClick(
                        'Inspect my current studio prompt and optimize it with Anima tag ordering and quality scores.'
                      )
                    "
                  >
                    <span>Inspect & optimize for Anima</span>
                    <ArrowUpRight class="text-muted-foreground h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    class="border-border bg-card/60 hover:bg-accent hover:border-primary/40 text-foreground flex cursor-pointer items-center justify-between rounded-lg border p-2.5 text-left text-sm transition-colors"
                    @click="
                      handleStarterClick(
                        'Create an Anima prompt for a fantasy mage girl with ornate layered robes, detached sleeves, and glowing runes.'
                      )
                    "
                  >
                    <span>Fantasy mage with detailed outfit</span>
                    <ArrowUpRight class="text-muted-foreground h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    class="border-border bg-card/60 hover:bg-accent hover:border-primary/40 text-foreground flex cursor-pointer items-center justify-between rounded-lg border p-2.5 text-left text-sm transition-colors"
                    @click="
                      handleStarterClick(
                        'Generate a high quality Anima aesthetic prompt featuring a swordsman atop a cliff under starlight with dramatic lighting.'
                      )
                    "
                  >
                    <span>Create Anima aesthetic prompt</span>
                    <ArrowUpRight class="text-muted-foreground h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <!-- Messages List -->
              <template v-for="msg in messages" :key="msg.id">
                <!-- User Message -->
                <div
                  v-if="msg.role === 'user'"
                  class="group flex flex-col items-end gap-1.5 pl-8"
                >
                  <!-- Attachments if any -->
                  <div
                    v-if="msg.attachments && msg.attachments.length > 0"
                    class="flex w-full flex-col items-end gap-2"
                  >
                    <button
                      v-for="att in msg.attachments"
                      :key="att.id"
                      type="button"
                      class="border-primary/30 bg-muted/20 hover:border-primary/60 relative max-h-80 w-full max-w-sm cursor-zoom-in overflow-hidden rounded-xl border shadow-xs transition-colors"
                      :aria-label="`View ${att.name || 'attached image'} fullscreen`"
                      @click="openChatImage(att.dataUrl, att.name)"
                    >
                      <img
                        :src="att.dataUrl"
                        :alt="att.name || 'Attached image'"
                        class="max-h-80 w-full object-contain"
                      />
                    </button>
                  </div>

                  <div
                    v-if="msg.mentions && msg.mentions.length > 0"
                    class="flex w-full flex-col items-end gap-2"
                  >
                    <div
                      v-for="mention in msg.mentions"
                      :key="mention.id"
                      class="flex w-full max-w-sm flex-col items-end gap-1.5"
                    >
                      <button
                        v-if="mention.imageDataUrl || mention.imageUrl"
                        type="button"
                        class="border-primary/30 bg-muted/20 hover:border-primary/60 max-h-80 w-full cursor-zoom-in overflow-hidden rounded-xl border shadow-xs transition-colors"
                        :aria-label="`View ${mention.label} fullscreen`"
                        @click="
                          openChatImage(
                            mention.imageDataUrl || mention.imageUrl || '',
                            mention.label
                          )
                        "
                      >
                        <img
                          :src="mention.imageDataUrl || mention.imageUrl"
                          :alt="mention.label"
                          class="max-h-80 w-full object-contain"
                        />
                      </button>
                      <AiMentionChip :mention="mention" :show-image="false" />
                    </div>
                  </div>

                  <!-- Text Content -->
                  <div
                    v-if="editingMessageId === msg.id"
                    class="w-full space-y-2"
                  >
                    <textarea
                      v-model="editingMessageText"
                      aria-label="Edit message"
                      rows="3"
                      class="border-primary/40 bg-background w-full rounded-xl border p-3 text-sm outline-none"
                      @keydown.escape="cancelMessageEdit"
                      @keydown.ctrl.enter.prevent="saveMessageEdit(msg.id)"
                    />
                    <div class="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        @click="cancelMessageEdit"
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        :disabled="
                          !editingMessageText.trim() || !aiStore.hasApiKey
                        "
                        @click="saveMessageEdit(msg.id)"
                      >
                        Save & regenerate
                      </Button>
                    </div>
                  </div>
                  <div
                    v-else-if="msg.content"
                    class="bg-primary text-primary-foreground rounded-2xl rounded-tr-xs px-3.5 py-2.5 text-sm leading-relaxed shadow-xs"
                  >
                    {{ msg.content }}
                  </div>
                  <div
                    v-if="editingMessageId !== msg.id"
                    class="flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
                  >
                    <button
                      v-if="msg.content"
                      type="button"
                      class="text-muted-foreground hover:text-foreground rounded p-1"
                      title="Edit and regenerate"
                      aria-label="Edit message"
                      @click="startMessageEdit(msg)"
                    >
                      <Pencil class="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      class="text-muted-foreground hover:text-destructive rounded p-1"
                      title="Delete this turn"
                      aria-label="Delete message"
                      @click="aiStore.deleteMessage(msg.id)"
                    >
                      <Trash2 class="h-3 w-3" />
                    </button>
                  </div>
                </div>

                <!-- Assistant Message -->
                <AssistantMessage
                  v-else
                  :msg="msg"
                  @open-image="openChatImage"
                />
              </template>
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton behavior="auto" />
        </MessageScroller>

        <!-- Bottom Input & Attachment Bar -->
        <div
          class="border-border bg-card/60 relative flex flex-col gap-2 border-t p-3 transition-colors"
          :class="{ 'bg-primary/5 ring-primary/40 ring-2': isDraggingOver }"
          @dragover.prevent="isDraggingOver = true"
          @dragleave.prevent="isDraggingOver = false"
          @drop.prevent="handleDrop"
        >
          <!-- Attached Images Preview Strip -->
          <div
            v-if="attachments.length > 0"
            class="flex items-center gap-2 overflow-x-auto pb-1"
          >
            <div
              v-for="att in attachments"
              :key="att.id"
              class="border-border group relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border shadow-xs"
            >
              <img
                :src="att.dataUrl"
                alt=""
                class="h-full w-full object-cover"
              />
              <button
                type="button"
                class="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100"
                title="Remove attachment"
                @click="removeAttachment(att.id)"
              >
                <X class="h-2.5 w-2.5" />
              </button>
            </div>
          </div>

          <div
            v-if="aiStore.draftMentions.length > 0"
            class="flex flex-wrap gap-1.5"
          >
            <AiMentionChip
              v-for="mention in aiStore.draftMentions"
              :key="mention.id"
              editable
              :mention="mention"
              :vision-supported="visionSupported"
              @remove="aiStore.removeDraftMention(mention.id)"
              @toggle-image="aiStore.toggleDraftMentionImage(mention.id)"
            />
          </div>

          <!-- Input Textarea & Send Control -->
          <div
            class="border-border bg-background focus-within:ring-primary focus-within:border-primary relative flex flex-col rounded-xl border transition-all focus-within:ring-1"
          >
            <textarea
              v-model="messageInput"
              rows="3"
              placeholder="Ask Anything"
              class="placeholder:text-muted-foreground w-full resize-none bg-transparent p-3 text-sm leading-relaxed outline-none"
              @keydown.enter.exact.prevent="handleSend"
              @paste="handlePaste"
            />

            <!-- Action Bar under Textarea -->
            <div
              class="border-border/30 flex items-center justify-between border-t px-2.5 pt-1 pb-2 text-xs"
            >
              <div class="flex items-center gap-1.5">
                <!-- Upload Image Button -->
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  class="text-muted-foreground hover:text-foreground h-7 w-7"
                  title="Attach image from file"
                  @click="openFilePicker"
                >
                  <ImagePlus class="h-4 w-4" />
                </Button>

                <!-- Attach Current Preview Button -->
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      class="text-muted-foreground hover:text-primary h-7 w-7"
                      :disabled="
                        !comfyStore.lastGeneratedImage &&
                        !comfyStore.currentPreviewUrl
                      "
                      @click="attachCurrentPreview"
                    >
                      <ScanEye class="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p class="text-xs">
                      Attach active ComfyUI preview image to chat
                    </p>
                  </TooltipContent>
                </Tooltip>

                <span
                  v-if="attachments.length > 0"
                  class="text-muted-foreground font-mono text-xs"
                >
                  {{ attachments.length }} image{{
                    attachments.length > 1 ? 's' : ''
                  }}
                </span>
              </div>

              <div
                class="flex min-w-0 flex-wrap items-center justify-end gap-1.5"
              >
                <!-- Model Selector -->
                <AiReasoningSelector compact :disabled="aiStore.isGenerating" />
                <AiModelSelector
                  compact
                  :disabled="aiStore.isGenerating"
                  :model-value="aiStore.config.selectedModel"
                  class="max-w-36 sm:max-w-48"
                  @change="handleModelChange"
                />

                <!-- Stop Button when Generating -->
                <Button
                  v-if="aiStore.isGenerating"
                  type="button"
                  size="sm"
                  variant="outline"
                  class="text-destructive hover:bg-destructive/10 h-7 shrink-0 gap-1 text-xs"
                  @click="aiStore.stopGeneration"
                >
                  <Square class="fill-destructive h-3 w-3" />
                  <span>Stop</span>
                </Button>

                <!-- Send Button -->
                <Button
                  v-else
                  type="button"
                  size="sm"
                  :disabled="
                    !messageInput.trim() &&
                    attachments.length === 0 &&
                    aiStore.draftMentions.length === 0
                  "
                  class="bg-primary text-primary-foreground h-7 shrink-0 gap-1.5 text-xs shadow-xs"
                  @click="handleSend"
                >
                  <span>Send</span>
                  <Send class="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </aside>

    <ImageLightboxModal
      :open="lightboxImage !== null"
      :src="lightboxImage?.src"
      :alt="lightboxImage?.title"
      :title="lightboxImage?.title"
      @update:open="closeChatImage"
    />
  </div>
</template>
