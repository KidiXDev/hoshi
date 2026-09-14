<script setup lang="ts">
import mayaMascot from '@/assets/maya-mascot.png';
import { computed, ref } from 'vue';
import {
  Check,
  ChevronRight,
  Eye,
  Library,
  Loader2,
  Play,
  Search,
  Sparkles,
  Trash2,
  Wand2,
  X
} from '@lucide/vue';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { Button } from '@/components/ui/button';
import {
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport
} from '@/components/ui/message-scroller';
import { useAiStore } from '@/stores/aiStore';
import type { ChatMessage, ChatMessagePart } from '@/types/ai';
import { formatRelativeTime } from '@/utils/formatters';

defineProps<{ msg: ChatMessage }>();
defineEmits<{
  openImage: [src: string, title?: string];
}>();
const aiStore = useAiStore();
const messages = computed(() => aiStore.activeMessages);
const expandedThoughts = ref<Record<string, boolean>>({});
const declineNotes = ref<Record<string, string>>({});
function toggleThought(msgId: string) {
  expandedThoughts.value[msgId] = !expandedThoughts.value[msgId];
}
function isThoughtExpanded(id: string): boolean {
  return !!expandedThoughts.value[id];
}
function getChronologicalParts(msg: ChatMessage): ChatMessagePart[] {
  let parts: ChatMessagePart[] = [];
  if (msg.parts && msg.parts.length > 0) {
    parts = msg.parts;
  } else {
    if (msg.reasoning) {
      parts.push({ type: 'reasoning', text: msg.reasoning, isComplete: true });
    }
    if (msg.toolInvocations && msg.toolInvocations.length > 0) {
      for (const inv of msg.toolInvocations) {
        parts.push({ type: 'tool', invocation: inv });
      }
    }
    if (msg.content) {
      parts.push({ type: 'text', text: msg.content });
    }
  }
  return parts.filter((part) => {
    if (part.type === 'text' && !part.text?.trim()) return false;
    if (part.type === 'reasoning' && !part.text?.trim() && part.isComplete)
      return false;
    return true;
  });
}
function isLastMessage(id: string): boolean {
  const last = messages.value.at(-1);
  return last?.id === id;
}
function isPartActive(msg: ChatMessage, index: number): boolean {
  if (msg.currentStep === 'awaiting_approval') return false;
  if (
    !aiStore.isGenerating ||
    !isLastMessage(msg.id) ||
    msg.currentStep === 'done'
  )
    return false;
  const parts = getChronologicalParts(msg);
  if (index !== parts.length - 1) return false;
  const part = parts[index];
  if (part.type === 'reasoning')
    return msg.currentStep === 'thinking' && !part.isComplete;
  if (part.type === 'tool')
    return (
      part.invocation.result === undefined &&
      msg.currentStep !== 'tool_completed'
    );
  return msg.currentStep === 'responding';
}
function renderMarkdown(content: string): string {
  if (!content) return '';

  let processed = content;
  // Gracefully auto-close dangling code fence during streaming
  const fenceCount = (processed.match(/```/gu) || []).length;
  if (fenceCount % 2 === 1) {
    processed += '\n```';
  }

  const rawHtml = marked.parse(processed, {
    async: false,
    gfm: true,
    breaks: true
  }) as string;
  return DOMPurify.sanitize(rawHtml);
}
</script>
<template>
  <div class="flex flex-col items-start gap-2 pr-2">
    <!-- Avatar & Header -->
    <div class="flex w-full items-center justify-between">
      <div
        class="text-muted-foreground flex items-center gap-1.5 text-xs font-medium"
      >
        <img
          :src="mayaMascot"
          alt=""
          class="border-primary/25 bg-primary/10 h-6 w-6 rounded-md border object-contain"
        />
        <span class="text-foreground font-semibold">Maya</span>
      </div>
      <div class="flex items-center gap-1">
        <span class="text-muted-foreground font-mono text-xs">
          {{ formatRelativeTime(msg.createdAt) }}
        </span>
        <button
          type="button"
          class="text-muted-foreground hover:text-destructive rounded p-1"
          title="Delete response"
          aria-label="Delete response"
          @click="aiStore.deleteMessage(msg.id)"
        >
          <Trash2 class="h-3 w-3" />
        </button>
      </div>
    </div>

    <!-- Message Body -->
    <div class="w-full text-sm select-text">
      <!-- Chronological Message Parts -->
      <div
        v-for="(part, pIdx) in getChronologicalParts(msg)"
        :key="`${msg.id}-part-${pIdx}`"
        class="border-border/60 relative ml-2 border-l pb-3 pl-5 last:border-transparent last:pb-0"
      >
        <span
          class="bg-sidebar absolute top-0 -left-2 flex h-4 w-4 items-center justify-center"
        >
          <span
            v-if="isPartActive(msg, pIdx)"
            class="bg-primary h-2 w-2 animate-pulse rounded-full"
          />
          <Check
            v-else-if="
              part.type === 'reasoning' ||
              (part.type === 'tool' && part.invocation.result !== undefined)
            "
            class="text-muted-foreground h-3 w-3 translate-y-1"
          />
          <span v-else class="bg-muted-foreground h-1.5 w-1.5 rounded-full" />
        </span>
        <!-- 1. Text Part -->
        <div
          v-if="part.type === 'text' && part.text"
          class="prose-chat select-text"
        >
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div v-html="renderMarkdown(part.text)" />
          <span
            v-if="isPartActive(msg, pIdx)"
            class="bg-primary/80 ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-xs align-middle"
          />
        </div>

        <!-- 2. Reasoning / Thinking Part -->
        <div v-else-if="part.type === 'reasoning' && part.text" class="text-sm">
          <button
            type="button"
            class="text-muted-foreground hover:text-foreground flex w-full cursor-pointer items-center justify-between gap-2 transition-colors"
            @click="toggleThought(`${msg.id}-${pIdx}`)"
            :aria-expanded="isThoughtExpanded(`${msg.id}-${pIdx}`)"
          >
            <div class="flex items-center gap-1.5 font-medium">
              <Sparkles
                class="text-primary h-3 w-3"
                :class="{
                  'animate-pulse': isPartActive(msg, pIdx)
                }"
              />
              <span>{{
                isPartActive(msg, pIdx) ? 'Thinking' : 'Thought'
              }}</span>
              <span
                v-if="isPartActive(msg, pIdx)"
                class="animate-text-shimmer font-mono text-xs"
              >
                pondering...
              </span>
            </div>
            <div class="flex items-center gap-1 text-xs">
              <span>{{
                isThoughtExpanded(`${msg.id}-${pIdx}`) ? 'Hide' : 'Show'
              }}</span>
              <ChevronRight
                class="h-3 w-3 transition-transform"
                :class="{
                  'rotate-90': isThoughtExpanded(`${msg.id}-${pIdx}`)
                }"
              />
            </div>
          </button>
          <MessageScrollerProvider
            v-if="isThoughtExpanded(`${msg.id}-${pIdx}`)"
            :auto-scroll="true"
          >
            <MessageScrollerViewport
              aria-label="Thinking details"
              class="border-border/20 text-muted-foreground mt-2 h-auto max-h-48 border-t pt-2 font-mono text-xs leading-relaxed select-text"
            >
              <MessageScrollerContent class="min-h-0 gap-0">
                <div class="whitespace-pre-wrap">
                  {{ part.text }}
                </div>
              </MessageScrollerContent>
            </MessageScrollerViewport>
          </MessageScrollerProvider>
        </div>

        <!-- 3. Tool Invocations -->
        <div v-else-if="part.type === 'tool'">
          <!-- Tool: inspect_current_prompt -->
          <div
            v-if="part.invocation.name === 'inspect_current_prompt'"
            class="text-sm"
          >
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <div
                  class="flex h-5 w-5 items-center justify-center rounded-md border text-blue-400"
                  :class="[
                    isPartActive(msg, pIdx)
                      ? 'border-primary/30 bg-primary/10 text-primary animate-spin'
                      : 'border-blue-500/30 bg-blue-500/10'
                  ]"
                >
                  <Sparkles
                    v-if="isPartActive(msg, pIdx)"
                    class="h-2.5 w-2.5"
                  />
                  <Eye v-else class="h-3 w-3" />
                </div>
                <span
                  class="text-foreground font-medium"
                  :class="{
                    'animate-text-shimmer': isPartActive(msg, pIdx)
                  }"
                >
                  {{
                    part.invocation.result
                      ? 'Prompts Inspected'
                      : isPartActive(msg, pIdx)
                        ? 'Inspecting active prompts...'
                        : 'Prompt inspection stopped'
                  }}
                </span>
              </div>

              <button
                v-if="part.invocation.result"
                type="button"
                class="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1 text-xs transition-colors"
                @click="toggleThought(`${msg.id}-tool-${part.invocation.id}`)"
              >
                <span>{{
                  isThoughtExpanded(`${msg.id}-tool-${part.invocation.id}`)
                    ? 'Hide details'
                    : 'View details'
                }}</span>
                <ChevronRight
                  class="h-3 w-3 transition-transform"
                  :class="{
                    'rotate-90': isThoughtExpanded(
                      `${msg.id}-tool-${part.invocation.id}`
                    )
                  }"
                />
              </button>
            </div>

            <!-- Expanded prompt details -->
            <div
              v-if="
                isThoughtExpanded(`${msg.id}-tool-${part.invocation.id}`) &&
                part.invocation.result
              "
              class="border-border/30 mt-2.5 flex flex-col gap-1.5 border-t pt-2 font-mono text-xs"
            >
              <div
                v-if="(part.invocation.result as any).positivePrompt"
                class="flex flex-col gap-0.5"
              >
                <span
                  class="text-primary font-sans text-xs font-semibold uppercase"
                  >Active Positive</span
                >
                <p class="text-foreground/90 whitespace-pre-wrap select-text">
                  {{ (part.invocation.result as any).positivePrompt }}
                </p>
              </div>
              <div
                v-if="(part.invocation.result as any).negativePrompt"
                class="flex flex-col gap-0.5"
              >
                <span
                  class="text-muted-foreground font-sans text-xs font-semibold uppercase"
                  >Active Negative</span
                >
                <p
                  class="text-muted-foreground whitespace-pre-wrap select-text"
                >
                  {{ (part.invocation.result as any).negativePrompt }}
                </p>
              </div>
            </div>
          </div>

          <!-- Animadex lookup -->
          <div
            v-else-if="
              part.invocation.name === 'search_animadex' ||
              part.invocation.name === 'retrieve_animadex_tag_by_id'
            "
            class="flex items-center gap-2 text-sm"
          >
            <div
              class="flex h-5 w-5 items-center justify-center rounded-md border transition-colors duration-200"
              :class="
                part.invocation.result
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                  : part.invocation.state === 'rejected'
                    ? 'border-muted bg-muted/40 text-muted-foreground'
                    : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400'
              "
            >
              <Transition
                mode="out-in"
                enter-active-class="transition duration-200 ease-out"
                enter-from-class="scale-75 opacity-0"
                leave-active-class="transition duration-100 ease-in"
                leave-to-class="scale-75 opacity-0"
              >
                <Search
                  v-if="part.invocation.result"
                  key="done"
                  class="h-3 w-3"
                />
                <X
                  v-else-if="part.invocation.state === 'rejected'"
                  key="cancelled"
                  class="h-3 w-3"
                />
                <Loader2 v-else key="searching" class="h-3 w-3 animate-spin" />
              </Transition>
            </div>
            <Transition
              mode="out-in"
              enter-active-class="transition duration-200 ease-out"
              enter-from-class="translate-y-0.5 opacity-0"
              leave-active-class="transition duration-100 ease-in"
              leave-to-class="-translate-y-0.5 opacity-0"
            >
              <span
                :key="
                  part.invocation.result
                    ? 'done'
                    : part.invocation.state === 'rejected'
                      ? 'cancelled'
                      : 'searching'
                "
                class="text-foreground font-medium"
              >
                {{
                  part.invocation.result
                    ? 'Done'
                    : part.invocation.state === 'rejected'
                      ? 'Search cancelled'
                      : 'Searching...'
                }}
              </span>
            </Transition>
          </div>

          <!-- Character Library search -->
          <div
            v-else-if="part.invocation.name === 'search_character_library'"
            class="flex items-center gap-2 text-sm"
          >
            <div
              class="flex h-5 w-5 items-center justify-center rounded-md border transition-colors duration-200"
              :class="
                part.invocation.result
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                  : part.invocation.state === 'rejected'
                    ? 'border-muted bg-muted/40 text-muted-foreground'
                    : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400'
              "
            >
              <Transition
                mode="out-in"
                enter-active-class="transition duration-200 ease-out"
                enter-from-class="scale-75 opacity-0"
                leave-active-class="transition duration-100 ease-in"
                leave-to-class="scale-75 opacity-0"
              >
                <Library
                  v-if="part.invocation.result"
                  key="done"
                  class="h-3 w-3"
                />
                <X
                  v-else-if="part.invocation.state === 'rejected'"
                  key="cancelled"
                  class="h-3 w-3"
                />
                <Loader2 v-else key="searching" class="h-3 w-3 animate-spin" />
              </Transition>
            </div>
            <Transition
              mode="out-in"
              enter-active-class="transition duration-200 ease-out"
              enter-from-class="translate-y-0.5 opacity-0"
              leave-active-class="transition duration-100 ease-in"
              leave-to-class="-translate-y-0.5 opacity-0"
            >
              <span
                :key="
                  part.invocation.result
                    ? 'done'
                    : part.invocation.state === 'rejected'
                      ? 'cancelled'
                      : 'searching'
                "
                class="text-foreground font-medium"
              >
                {{
                  part.invocation.result
                    ? 'Character Library Inspected'
                    : part.invocation.state === 'rejected'
                      ? 'Library search cancelled'
                      : 'Searching Character Library...'
                }}
              </span>
            </Transition>
          </div>

          <!-- Prompt update -->
          <div
            v-else-if="
              part.invocation.name === 'inject_positive_prompt' ||
              part.invocation.name === 'inject_negative_prompt'
            "
            class="text-sm"
          >
            <div class="mb-2 flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <div
                  class="border-primary/30 bg-primary/10 text-primary flex h-5 w-5 items-center justify-center rounded-md border"
                >
                  <Wand2 class="h-3 w-3" />
                </div>
                <span class="text-foreground text-sm font-semibold">
                  {{
                    part.invocation.name === 'inject_positive_prompt'
                      ? 'Proposed Positive Prompt'
                      : part.invocation.name === 'inject_negative_prompt'
                        ? 'Proposed Negative Prompt'
                        : 'Proposed Prompt Adjustments'
                  }}
                </span>
              </div>
              <span
                class="rounded-full px-2 py-0.5 font-mono text-xs font-medium"
                :class="[
                  part.invocation.state === 'applied'
                    ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                    : part.invocation.state === 'queued'
                      ? 'border border-purple-500/20 bg-purple-500/10 text-purple-400'
                      : part.invocation.state === 'rejected'
                        ? 'bg-muted text-muted-foreground'
                        : 'border-primary/20 bg-primary/10 text-primary border'
                ]"
              >
                {{
                  part.invocation.state === 'applied'
                    ? '✓ Applied'
                    : part.invocation.state === 'building'
                      ? 'Preparing...'
                      : part.invocation.state === 'queued'
                        ? '✓ Applied & Queued'
                        : part.invocation.state === 'rejected'
                          ? '✕ Discarded'
                          : 'Pending Confirmation'
                }}
              </span>
            </div>

            <p
              v-if="typeof part.invocation.args.reason === 'string'"
              class="text-muted-foreground mb-2 text-sm italic"
            >
              {{ part.invocation.args.reason }}
            </p>

            <div
              v-if="part.invocation.state === 'building'"
              class="text-muted-foreground flex items-center gap-2 py-2"
            >
              <Sparkles class="text-primary h-3.5 w-3.5 animate-pulse" />
              <span class="animate-text-shimmer">
                {{
                  part.invocation.name === 'inject_positive_prompt'
                    ? 'Preparing positive prompt proposal...'
                    : 'Preparing negative prompt proposal...'
                }}
              </span>
            </div>
            <div
              v-else
              class="border-border/40 bg-muted/20 mb-2 rounded-lg border p-2 font-mono text-xs whitespace-pre-wrap"
            >
              {{
                part.invocation.args.prompt ??
                (part.invocation.name === 'inject_positive_prompt'
                  ? part.invocation.args.positive
                  : part.invocation.args.negative)
              }}
            </div>

            <!-- Action buttons if pending -->
          </div>

          <!-- Tool: queue_generation -->
          <div
            v-else-if="part.invocation.name === 'queue_generation'"
            class="text-sm"
          >
            <div class="mb-1.5 flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <div
                  class="flex h-5 w-5 items-center justify-center rounded-md border border-purple-500/30 bg-purple-500/10 text-purple-400"
                >
                  <Play class="h-3 w-3" />
                </div>
                <span class="text-foreground text-sm font-semibold"
                  >Queue Generation</span
                >
              </div>
              <span
                class="rounded-full px-2 py-0.5 font-mono text-xs font-medium"
                :class="[
                  part.invocation.state === 'queued'
                    ? 'border border-purple-500/20 bg-purple-500/10 text-purple-400'
                    : 'border-primary/20 bg-primary/10 text-primary border'
                ]"
              >
                {{
                  part.invocation.result
                    ? '✓ Done'
                    : part.invocation.state === 'queued'
                      ? 'Generating...'
                      : part.invocation.state === 'building'
                        ? 'Preparing...'
                        : part.invocation.state === 'rejected'
                          ? 'Declined'
                          : 'Pending Confirmation'
                }}
              </span>
            </div>

            <p
              v-if="typeof part.invocation.args.reason === 'string'"
              class="text-muted-foreground mb-2 text-sm"
            >
              {{ part.invocation.args.reason }}
            </p>
            <button
              v-if="(part.invocation.result as any)?.image?.url"
              type="button"
              class="mt-2 block w-full cursor-pointer"
              :aria-label="`Open ${(part.invocation.result as any).image.filename || 'generated image'} fullscreen`"
              @click="
                $emit(
                  'openImage',
                  (part.invocation.result as any).image.url,
                  (part.invocation.result as any).image.filename ||
                    'Generated image'
                )
              "
            >
              <img
                :src="(part.invocation.result as any).image.url"
                :alt="
                  (part.invocation.result as any).image.filename ||
                  'Generated image'
                "
                class="border-border max-h-72 w-full rounded-lg border object-contain"
              />
            </button>
            <div
              v-if="part.invocation.state === 'building'"
              class="text-muted-foreground flex items-center gap-2 py-2"
            >
              <Sparkles class="text-primary h-3.5 w-3.5 animate-pulse" />
              <span class="animate-text-shimmer"
                >Preparing generation request...</span
              >
            </div>
          </div>
          <div
            v-if="
              part.invocation.state === 'pending' &&
              msg.currentStep === 'awaiting_approval'
            "
            class="mt-2 space-y-2"
          >
            <p class="text-muted-foreground text-sm">
              Waiting for your approval. The assistant is paused.
            </p>
            <textarea
              v-model="declineNotes[part.invocation.id]"
              aria-label="Optional decline note"
              placeholder="Optional note if you decline..."
              rows="2"
              class="border-border bg-background w-full rounded-md border p-2 text-sm"
            />
            <div class="flex items-center gap-2">
              <Button
                size="sm"
                variant="default"
                @click="aiStore.applyToolInvocation(msg.id, part.invocation.id)"
                >Accept</Button
              >
              <Button
                size="sm"
                variant="ghost"
                @click="
                  aiStore.rejectToolInvocation(
                    msg.id,
                    part.invocation.id,
                    declineNotes[part.invocation.id]
                  )
                "
                class="text-destructive"
                >Decline</Button
              >
            </div>
          </div>
          <p
            v-if="part.invocation.note"
            class="text-muted-foreground mt-2 text-xs"
          >
            Decline note: {{ part.invocation.note }}
          </p>
        </div>
      </div>

      <div
        v-if="
          aiStore.isGenerating &&
          isLastMessage(msg.id) &&
          getChronologicalParts(msg).length === 0
        "
        class="text-muted-foreground flex items-center gap-2 py-1 text-sm"
      >
        <Sparkles class="text-primary h-3.5 w-3.5 animate-pulse" />
        <span class="animate-text-shimmer font-mono font-medium tracking-wide">
          Thinking...
        </span>
      </div>
    </div>
  </div>
</template>
<style scoped>
@keyframes text-shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}

.animate-text-shimmer {
  background: linear-gradient(
    90deg,
    rgba(148, 163, 184, 0.35) 0%,
    rgba(255, 255, 255, 0.95) 50%,
    rgba(148, 163, 184, 0.35) 100%
  );
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: text-shimmer 2s ease-in-out infinite;
  display: inline-block;
}

/* Typography styles for external marked renderer */
:deep(.prose-chat) {
  font-size: 0.8125rem;
  line-height: 1.65;
  color: var(--color-foreground);
  letter-spacing: 0.01em;
}

:deep(.prose-chat p) {
  margin: 0.5rem 0;
}

:deep(.prose-chat p:first-child) {
  margin-top: 0;
}

:deep(.prose-chat p:last-child) {
  margin-bottom: 0;
}

:deep(.prose-chat strong) {
  font-weight: 600;
  color: var(--color-foreground);
}

:deep(.prose-chat pre) {
  background-color: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--color-border);
  border-radius: 0.625rem;
  padding: 0.75rem 0.875rem;
  margin: 0.625rem 0;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1.55;
}

:deep(.prose-chat code:not(pre code)) {
  background-color: var(--color-muted);
  color: var(--color-primary);
  border-radius: 0.25rem;
  padding: 0.125rem 0.375rem;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-weight: 600;
}

:deep(.prose-chat h1) {
  font-size: 1rem;
  font-weight: 700;
  margin-top: 0.875rem;
  margin-bottom: 0.375rem;
  color: var(--color-foreground);
}

:deep(.prose-chat h2) {
  font-size: 0.9375rem;
  font-weight: 600;
  margin-top: 0.75rem;
  margin-bottom: 0.375rem;
  color: var(--color-foreground);
}

:deep(.prose-chat h3) {
  font-size: 0.875rem;
  font-weight: 600;
  margin-top: 0.625rem;
  margin-bottom: 0.25rem;
  color: var(--color-foreground);
}

:deep(.prose-chat ul) {
  list-style-type: disc;
  margin-left: 1.125rem;
  margin-top: 0.375rem;
  margin-bottom: 0.5rem;
}

:deep(.prose-chat ol) {
  list-style-type: decimal;
  margin-left: 1.25rem;
  margin-top: 0.375rem;
  margin-bottom: 0.5rem;
}

:deep(.prose-chat li) {
  margin: 0.25rem 0;
  line-height: 1.6;
}

:deep(.prose-chat blockquote) {
  border-left: 3px solid var(--color-primary);
  background-color: rgba(59, 130, 246, 0.05);
  border-radius: 0 0.375rem 0.375rem 0;
  padding: 0.375rem 0.75rem;
  margin: 0.5rem 0;
  font-style: italic;
  color: var(--color-muted-foreground);
}

:deep(.prose-chat a) {
  color: var(--color-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}

:deep(.prose-chat table) {
  width: 100%;
  border-collapse: collapse;
  margin: 0.625rem 0;
  font-size: 0.75rem;
}

:deep(.prose-chat th),
:deep(.prose-chat td) {
  border: 1px solid var(--color-border);
  padding: 0.375rem 0.5rem;
  text-align: left;
}

:deep(.prose-chat th) {
  background-color: var(--color-muted);
  font-weight: 600;
}
</style>
