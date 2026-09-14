import { isStepCount, streamText, tool } from 'ai';
import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import { z } from 'zod';
import {
  buildSystemPrompt,
  DEFAULT_AI_CONFIG,
  fetchAvailableModels,
  generateChatTitle,
  getOpenRouterModel,
  POPULAR_MODELS
} from '../services/aiService';
import {
  searchArtists,
  searchCharacters,
  searchCopyrights
} from '../services/animadexApi';
import { loadAppData, saveAppData } from '../services/appStorage';
import { LibraryService } from '../services/libraryService';
import type {
  AiConfig,
  ChatMessage,
  ChatMessageAttachment,
  ChatMessageMention,
  ChatMessagePart,
  ChatSession,
  OpenRouterModel,
  ToolInvocation,
  ToolName
} from '../types/ai';
import type { CharacterData } from '../types/library';
import { mentionReference, supportsVision } from '../utils/aiMentions';
import { searchCharacterEntries } from '../utils/librarySearch';
import { useComfyStore } from './comfyStore';
import { useWorkflowStore } from './workflowStore';

type ApprovalDecision = {
  action: 'accept' | 'decline';
  note?: string;
};

const READ_ONLY_TOOLS: ToolName[] = [
  'inspect_current_prompt',
  'search_animadex',
  'retrieve_animadex_tag_by_id',
  'search_character_library'
];
const NOOP = () => {};

function sanitizeLegacySessionInvocations(session: ChatSession) {
  for (const msg of session.messages) {
    if (msg.toolInvocations) {
      for (const inv of msg.toolInvocations) {
        if (inv.state === 'pending' || inv.state === 'building')
          inv.state = 'rejected';
        if (inv.name === 'inspect_current_prompt') {
          inv.state = 'applied';
        }
      }
    }
    for (const part of msg.parts ?? []) {
      if (
        part.type === 'tool' &&
        (part.invocation.state === 'pending' ||
          part.invocation.state === 'building')
      )
        part.invocation.state = 'rejected';
    }
    // Synthesize chronological parts for legacy messages if not present
    if (!msg.parts || msg.parts.length === 0) {
      const parts: ChatMessagePart[] = [];
      if (msg.reasoning) {
        parts.push({
          type: 'reasoning',
          text: msg.reasoning,
          isComplete: true
        });
      }
      if (msg.toolInvocations && msg.toolInvocations.length > 0) {
        for (const inv of msg.toolInvocations) {
          parts.push({ type: 'tool', invocation: inv });
        }
      }
      if (msg.content) {
        parts.push({ type: 'text', text: msg.content });
      }
      msg.parts = parts;
    }
  }
}

function appendTextPart(parts: ChatMessagePart[], text: string) {
  const lastPart = parts.at(-1);
  if (lastPart && lastPart.type === 'text') {
    lastPart.text += text;
  } else {
    parts.push({ type: 'text', text });
  }
}

function appendReasoningPart(parts: ChatMessagePart[], text: string) {
  const lastPart = parts.at(-1);
  if (lastPart?.type === 'reasoning' && !lastPart.isComplete) {
    lastPart.text += text;
  } else {
    parts.push({ type: 'reasoning', text });
  }
}

function limitChatContext<T extends { role: string; content: unknown }>(
  messages: T[],
  tokenLimit: number
): T[] {
  // ponytail: token estimate is enough for budgeting; use a model tokenizer if exact limits become necessary.
  const characterBudget = Math.max(1, tokenLimit) * 4;
  let usedCharacters = 0;
  let startIndex = messages.length - 1;
  for (let index = messages.length - 1; index >= 0; index--) {
    const content = messages[index].content;
    const characterCount =
      typeof content === 'string'
        ? content.length
        : JSON.stringify(content).length;
    if (
      index < messages.length - 1 &&
      usedCharacters + characterCount > characterBudget
    )
      break;
    usedCharacters += characterCount;
    startIndex = index;
  }
  while (
    startIndex < messages.length - 1 &&
    messages[startIndex].role !== 'user'
  )
    startIndex++;
  return messages.slice(startIndex);
}

async function prepareMentionImages(
  mentions: ChatMessageMention[],
  canUseVision: boolean
) {
  return await Promise.all(
    mentions.map(async (mention) => {
      if (
        !canUseVision ||
        !mention.includeImage ||
        !mention.imageUrl ||
        mention.imageDataUrl
      )
        return mention;
      try {
        const response = await fetch(mention.imageUrl);
        if (!response.ok) throw new Error('Image request failed');
        const blob = await response.blob();
        const imageDataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        return { ...mention, imageDataUrl, imageUnavailable: false };
      } catch {
        return { ...mention, imageUnavailable: true };
      }
    })
  );
}

export const useAiStore = defineStore('ai', () => {
  const workflowStore = useWorkflowStore();
  const comfyStore = useComfyStore();

  const config = ref<AiConfig>({ ...DEFAULT_AI_CONFIG });
  const sessions = ref<ChatSession[]>([]);
  const activeSessionId = ref<string>('');
  const isDrawerOpen = ref(false);
  const models = ref<OpenRouterModel[]>([...POPULAR_MODELS]);
  const isLoadingModels = ref(false);
  const isGenerating = ref(false);
  const draftMentions = ref<ChatMessageMention[]>([]);
  const isLoaded = ref(false);
  let currentAbortController: AbortController | null = null;
  const approvals = new Map<
    string,
    {
      messageId: string;
      promise: Promise<ApprovalDecision>;
      resolve: (decision: ApprovalDecision) => void;
    }
  >();

  const hasApiKey = computed(() => !!config.value.apiKey.trim());

  const activeSession = computed<ChatSession | undefined>(() => {
    if (sessions.value.length === 0) return;
    const found = sessions.value.find((s) => s.id === activeSessionId.value);
    return found || sessions.value[0];
  });

  const activeMessages = computed<ChatMessage[]>(() => {
    return activeSession.value?.messages || [];
  });

  const selectedModelInfo = computed<OpenRouterModel | undefined>(() => {
    return models.value.find((m) => m.id === config.value.selectedModel);
  });

  async function loadConfig() {
    try {
      const saved = await loadAppData<Partial<AiConfig>>('ai_config');
      if (saved) {
        config.value = {
          ...DEFAULT_AI_CONFIG,
          ...saved
        };
      }
    } catch (err) {
      console.warn('Failed to load AI config:', err);
    }
  }

  async function saveConfig() {
    try {
      await saveAppData('ai_config', config.value);
    } catch (err) {
      console.error('Failed to save AI config:', err);
    }
  }

  async function loadChatSessions() {
    try {
      const saved = await loadAppData<ChatSession[]>('chat_sessions');
      if (Array.isArray(saved) && saved.length > 0) {
        // Sanitize any legacy inspect_current_prompt that might have been saved as 'pending'
        saved.forEach((s) => sanitizeLegacySessionInvocations(s));
        sessions.value = saved;
        if (
          !activeSessionId.value ||
          !sessions.value.some((s) => s.id === activeSessionId.value)
        ) {
          activeSessionId.value = sessions.value[0].id;
        }
      } else {
        createSession('New Chat');
      }
    } catch (err) {
      console.warn('Failed to load chat sessions:', err);
      if (sessions.value.length === 0) {
        createSession('New Chat');
      }
    }
  }

  async function saveChatSessions() {
    try {
      // Serialize sessions, ensuring not to save transient state
      await saveAppData('chat_sessions', sessions.value);
    } catch (err) {
      console.error('Failed to save chat sessions to chat.dat:', err);
    }
  }

  function createSession(title = 'New Chat'): ChatSession {
    const newSession = reactive<ChatSession>({
      id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: []
    });
    sessions.value.unshift(newSession);
    activeSessionId.value = newSession.id;
    void saveChatSessions();
    return newSession;
  }

  async function generateSessionTitle(session: ChatSession, text: string) {
    const fallback = session.title;
    try {
      const title = await generateChatTitle(config.value, text);
      // Only apply if the user hasn't renamed the session meanwhile
      if (title && session.title === fallback) {
        session.title = title;
        void saveChatSessions();
      }
    } catch (err) {
      console.warn('Failed to auto-generate session title:', err);
    }
  }

  function switchSession(id: string) {
    if (sessions.value.some((s) => s.id === id)) {
      activeSessionId.value = id;
    }
  }

  function deleteSession(id: string) {
    if (
      sessions.value
        .find((s) => s.id === id)
        ?.messages.some((m) =>
          [...approvals.values()].some((a) => a.messageId === m.id)
        )
    )
      stopGeneration();
    const index = sessions.value.findIndex((s) => s.id === id);
    if (index !== -1) {
      sessions.value.splice(index, 1);
      if (sessions.value.length === 0) {
        createSession('New Chat');
      } else if (activeSessionId.value === id) {
        activeSessionId.value = sessions.value[0].id;
      }
      void saveChatSessions();
    }
  }

  function renameSession(id: string, newTitle: string) {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    const session = sessions.value.find((s) => s.id === id);
    if (session) {
      session.title = trimmed;
      session.updatedAt = Date.now();
      void saveChatSessions();
    }
  }

  function clearAllSessions() {
    stopGeneration();
    sessions.value = [];
    createSession('New Chat');
  }

  function deleteMessage(messageId: string) {
    const session = activeSession.value;
    if (!session) return;
    const index = session.messages.findIndex(
      (message) => message.id === messageId
    );
    if (index === -1) return;
    if (isGenerating.value) stopGeneration();
    const message = session.messages[index];
    const nextUserIndex =
      message.role === 'user'
        ? session.messages.findIndex(
            (candidate, candidateIndex) =>
              candidateIndex > index && candidate.role === 'user'
          )
        : index + 1;
    session.messages.splice(
      index,
      nextUserIndex === -1
        ? session.messages.length - index
        : nextUserIndex - index
    );
    session.updatedAt = Date.now();
    void saveChatSessions();
  }

  async function editMessageAndRegenerate(messageId: string, content: string) {
    const session = activeSession.value;
    const text = content.trim();
    if (!session || !text || isGenerating.value) return;
    if (!config.value.apiKey.trim())
      throw new Error('OpenRouter API key is not configured.');
    const index = session.messages.findIndex(
      (message) => message.id === messageId && message.role === 'user'
    );
    if (index === -1) return;
    const attachments = session.messages[index].attachments ?? [];
    const mentions = session.messages[index].mentions ?? [];
    session.messages.splice(index);
    await sendMessage(text, attachments, mentions);
  }

  async function refreshModels(force = false) {
    isLoadingModels.value = true;
    try {
      const list = await fetchAvailableModels(config.value.apiKey, force);
      if (list && list.length > 0) {
        models.value = list;
      }
    } catch (err) {
      console.warn('Error refreshing models:', err);
    } finally {
      isLoadingModels.value = false;
    }
  }

  function stopGeneration() {
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
  }

  function addDraftMention(mention: ChatMessageMention) {
    const existing = draftMentions.value.findIndex(
      (item) =>
        item.source === mention.source && item.sourceId === mention.sourceId
    );
    if (existing === -1) {
      draftMentions.value.push(mention);
    } else {
      draftMentions.value[existing] = {
        ...mention,
        includeImage: draftMentions.value[existing].includeImage
      };
    }
  }

  function removeDraftMention(id: string) {
    draftMentions.value = draftMentions.value.filter(
      (mention) => mention.id !== id
    );
  }

  function toggleDraftMentionImage(id: string) {
    const mention = draftMentions.value.find((item) => item.id === id);
    if (mention) mention.includeImage = !mention.includeImage;
  }

  function clearDraftMentions() {
    draftMentions.value = [];
  }

  async function sendMessage(
    text: string,
    attachments: ChatMessageAttachment[] = [],
    mentions: ChatMessageMention[] = []
  ) {
    if (isGenerating.value) return;
    if (!config.value.apiKey.trim()) {
      throw new Error(
        'OpenRouter API key is not configured. Please set it in Settings or the AI Drawer.'
      );
    }

    let session = activeSession.value;
    if (!session) {
      session = createSession();
    }

    const preparedMentions = await prepareMentionImages(
      mentions,
      supportsVision(selectedModelInfo.value)
    );
    const userMessageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-user`;
    const userMsg: ChatMessage = {
      id: userMessageId,
      role: 'user',
      content: text,
      createdAt: Date.now(),
      attachments: attachments.length > 0 ? [...attachments] : undefined,
      mentions: preparedMentions.length > 0 ? preparedMentions : undefined
    };
    session.messages.push(userMsg);
    session.updatedAt = Date.now();

    if (
      session.messages.filter((m) => m.role === 'user').length === 1 &&
      session.title === 'New Chat'
    ) {
      session.title = text.trim().slice(0, 32) || 'Prompt Session';
      void generateSessionTitle(session, text);
    }

    const assistantMessageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-assistant`;
    const assistantMsg = reactive<ChatMessage>({
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      parts: [],
      createdAt: Date.now(),
      toolInvocations: [],
      reasoning: '',
      currentStep: 'thinking'
    });
    session.messages.push(assistantMsg);

    isGenerating.value = true;
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    try {
      const model = getOpenRouterModel(config.value, selectedModelInfo.value);
      const systemPrompt = buildSystemPrompt(config.value.customSystemPrompt);

      const getOrCreateInvocation = (
        id: string,
        name: ToolName,
        args: Record<string, unknown> = {},
        state: ToolInvocation['state'] = 'building'
      ) => {
        const existing = assistantMsg.toolInvocations?.find(
          (invocation) => invocation.id === id
        );
        if (existing) {
          existing.name = name;
          existing.args = args;
          existing.state = state;
          return existing;
        }
        const invocation = reactive<ToolInvocation>({
          id,
          name,
          args,
          state,
          timestamp: Date.now()
        });
        assistantMsg.toolInvocations?.push(invocation);
        assistantMsg.parts?.push({ type: 'tool', invocation });
        return invocation;
      };
      let approvalTail = Promise.resolve();

      // Exclude the empty assistant placeholder from history
      const coreMessages = session.messages
        .slice(0, -1)
        .filter((m) => m.role === 'user' || m.content.trim())
        .map((m) => {
          if (m.role === 'user') {
            const textWithReferences = [
              m.content,
              ...(m.mentions ?? []).map((mention) => mentionReference(mention))
            ]
              .filter(Boolean)
              .join('\n\n');
            const mentionImages = supportsVision(selectedModelInfo.value)
              ? (m.mentions ?? []).filter(
                  (mention) => mention.includeImage && mention.imageDataUrl
                )
              : [];
            if (
              (m.attachments && m.attachments.length > 0) ||
              mentionImages.length > 0
            ) {
              const parts: Array<
                | { type: 'text'; text: string }
                | { type: 'image'; image: string }
              > = [];
              if (textWithReferences) {
                parts.push({ type: 'text', text: textWithReferences });
              }
              for (const att of m.attachments ?? []) {
                parts.push({ type: 'image', image: att.dataUrl });
              }
              for (const mention of mentionImages) {
                if (mention.imageDataUrl) {
                  parts.push({ type: 'image', image: mention.imageDataUrl });
                }
              }
              return {
                role: 'user' as const,
                content: parts
              };
            }
            return {
              role: 'user' as const,
              content: textWithReferences
            };
          }
          return {
            role: 'assistant' as const,
            content: m.content
          };
        });

      const executeStudioTool = async (
        name:
          | 'inject_positive_prompt'
          | 'inject_negative_prompt'
          | 'queue_generation',
        input: { prompt?: string; reason?: string },
        toolCallId: string
      ) => {
        signal.throwIfAborted();
        const inv = getOrCreateInvocation(
          toolCallId,
          name,
          input,
          config.value.autoApply ? 'pending' : 'building'
        );
        let releaseApproval = NOOP;
        try {
          let decision: ApprovalDecision = { action: 'accept' };
          if (!config.value.autoApply) {
            const previousApproval = approvalTail;
            approvalTail = new Promise<void>((resolve) => {
              releaseApproval = resolve;
            });
            await previousApproval;
            signal.throwIfAborted();
            inv.state = 'pending';
            assistantMsg.currentStep = 'awaiting_approval';
            let resolveDecision!: (value: ApprovalDecision) => void;
            const promise = new Promise<ApprovalDecision>((resolve) => {
              resolveDecision = resolve;
            });
            const abort = () => finish({ action: 'decline' });
            const finish = (value: ApprovalDecision) => {
              signal.removeEventListener('abort', abort);
              resolveDecision(value);
            };
            approvals.set(toolCallId, {
              messageId: assistantMsg.id,
              promise,
              resolve: finish
            });
            signal.addEventListener('abort', abort, { once: true });
            decision = await promise;
          }
          signal.throwIfAborted();
          inv.note = decision.note;
          if (decision.action === 'decline') {
            inv.state = 'rejected';
            return {
              status: 'rejected_by_user',
              note: decision.note || '',
              applied: false
            };
          }
          if (name !== 'queue_generation' && typeof input.prompt !== 'string')
            throw new Error('Prompt text is required');
          if (
            name === 'inject_positive_prompt' &&
            typeof input.prompt === 'string'
          )
            workflowStore.positivePrompt = input.prompt;
          if (
            name === 'inject_negative_prompt' &&
            typeof input.prompt === 'string'
          )
            workflowStore.negativePrompt = input.prompt;
          inv.state = name === 'queue_generation' ? 'pending' : 'applied';
          if (name === 'queue_generation') {
            assistantMsg.currentStep = 'queueing';
            const promptId = await comfyStore.queueGeneration(
              workflowStore.getFullWorkflowState()
            );
            inv.state = promptId
              ? 'queued'
              : name === 'queue_generation'
                ? 'rejected'
                : 'applied';
            if (!promptId) return { status: 'generation_failed' };
            const image = await comfyStore.waitForGeneration(promptId, signal);
            return {
              status: 'generation_completed',
              prompt: input.prompt,
              image
            };
          }
          return {
            status: 'applied',
            prompt: input.prompt,
            message:
              'The prompt is applied and already displayed in the injection card. Confirm briefly without repeating the prompt. This has not generated an image; continue to generation only if the user requested it.'
          };
        } catch (error) {
          if (
            inv.state === 'building' ||
            inv.state === 'pending' ||
            inv.state === 'queued'
          )
            inv.state = 'rejected';
          throw error;
        } finally {
          releaseApproval();
          approvals.delete(toolCallId);
          void saveChatSessions();
        }
      };

      const tools = {
        inspect_current_prompt: tool({
          description:
            'Inspect the currently active positive and negative prompts in the studio.',
          inputSchema: z.object({}),
          execute: async () => {
            return {
              positivePrompt: workflowStore.positivePrompt || '',
              negativePrompt: workflowStore.negativePrompt || ''
            };
          }
        }),

        search_animadex: tool({
          description:
            'Search the Animadex catalogue for characters, artists, or copyrights/series. Character results are reference data only: tags may be accurate but incomplete, may cover only basic appearance such as hair or eye color while omitting clothing and other details, or may be empty. Never treat an omitted tag as proof that the character lacks that feature.',
          inputSchema: z.object({
            query: z.string().min(1).describe('Search text'),
            category: z
              .enum(['characters', 'artists', 'copyrights'])
              .default('characters'),
            page: z.number().int().positive().default(1)
          }),
          execute: ({ query, category, page }) => {
            if (category === 'artists')
              return searchArtists({ q: query, page, sort: 'count' });
            if (category === 'copyrights')
              return searchCopyrights({ q: query, page, sort: 'count' });
            return searchCharacters({ q: query, page, sort: 'count' });
          }
        }),

        retrieve_animadex_tag_by_id: tool({
          description:
            'Retrieve a character trigger and available core tags from Animadex using its exact slug/ID. Treat the result only as a reference: tags may be accurate but incomplete, may describe only basic appearance while omitting clothing and other details, or may be empty. Never present missing tags as a complete character description or infer that omitted features are absent.',
          inputSchema: z.object({
            id: z.string().min(1).describe('Exact Animadex character slug/ID')
          }),
          execute: async ({ id }) => {
            const normalizedId = id.trim().toLowerCase();
            const response = await searchCharacters({
              character: [id.trim()],
              page: 1,
              sort: 'count'
            });
            const character = response.results.find(
              (item) => item.slug.toLowerCase() === normalizedId
            );
            if (!character)
              throw new Error(`Animadex character not found: ${id}`);
            return {
              id: character.slug,
              name: character.name,
              copyright: character.copyright_name,
              trigger: character.trigger,
              tags: character.tags,
              url: character.url
            };
          }
        }),

        inject_positive_prompt: tool({
          description:
            'Use this for requests to create an image or create, improve, replace, or apply the studio positive prompt. Writing prompt text in chat does not apply it. For edits, inspect the current prompt first. The UI displays the full prompt and handles approval; after success, confirm briefly without repeating it. Wait for this result before calling generation. Do not use for explicitly text-only drafts or explanations.',
          inputSchema: z.object({
            prompt: z.string().describe('New or enhanced positive prompt text'),
            reason: z
              .string()
              .optional()
              .describe('Stylistic enhancements or creative rationale')
          }),
          execute: (input, { toolCallId }) =>
            executeStudioTool('inject_positive_prompt', input, toolCallId)
        }),

        inject_negative_prompt: tool({
          description:
            'Change only the negative prompt, and only when the user explicitly requests a negative prompt change. Generic prompt improvements must use the positive prompt capability and preserve the current negative prompt. The UI displays the full prompt and handles approval; after success, confirm briefly without repeating it.',
          inputSchema: z.object({
            prompt: z.string().describe('New or enhanced negative prompt text'),
            reason: z
              .string()
              .optional()
              .describe('Negative blocker adjustments or rationale')
          }),
          execute: (input, { toolCallId }) =>
            executeStudioTool('inject_negative_prompt', input, toolCallId)
        }),

        queue_generation: tool({
          description:
            'Use when the user requests image generation, not merely prompt preparation. Delegate the current workflow to ComfyUI and wait for that exact job to finish. If the requested scene needs a prompt update, call injection first and wait for its successful result in a separate step; never queue alongside an unresolved or rejected injection. The completed result includes the generated image so you can briefly report completion without repeating the prompt.',
          inputSchema: z.object({
            reason: z
              .string()
              .optional()
              .describe('Reason for queueing generation')
          }),
          execute: (input, { toolCallId }) =>
            executeStudioTool('queue_generation', input, toolCallId)
        }),

        search_character_library: tool({
          description:
            "Search the user's local Character Library for custom, user-verified character definitions. Results here are always more reliable than Animadex for clothing, accessories, and detailed appearance tags. Prefer these results over Animadex when both are available for the same character. Entries may include user-written notes (personality, canon outfits, poses, things to avoid) — treat notes as authoritative extra context beyond the tags.",
          inputSchema: z.object({
            query: z
              .string()
              .min(1)
              .describe(
                'Character name, series, trigger tag, or any tag keyword to search for'
              )
          }),
          execute: async ({ query }) => {
            try {
              const entries =
                await LibraryService.listItems<CharacterData>('characters');
              const results = searchCharacterEntries(entries, query)
                .slice(0, 8)
                .map((item) => ({
                  name: item.name,
                  series: item.data.series,
                  trigger: item.data.trigger,
                  tags: item.data.tags,
                  source: item.data.source ?? 'local',
                  description: item.description,
                  notes: item.data.notes
                }));

              if (results.length === 0) {
                return {
                  found: false,
                  message:
                    'No characters found in your local library for that query. Try searching Animadex instead.'
                };
              }

              return {
                found: true,
                source: 'local_character_library',
                note: 'These are user-verified character definitions. Tags here are considered more complete and accurate than Animadex. Use the notes field for details beyond tags.',
                results
              };
            } catch (err) {
              return { found: false, error: String(err) };
            }
          }
        })
      };

      const result = streamText({
        model,
        system: systemPrompt,
        messages: limitChatContext(
          coreMessages,
          Math.min(
            config.value.contextTokenLimit,
            selectedModelInfo.value?.context_length ??
              config.value.contextTokenLimit
          )
        ),
        tools,
        temperature: config.value.temperature,
        maxOutputTokens: config.value.maxOutputTokens,
        stopWhen: isStepCount(5),
        abortSignal: currentAbortController.signal
      });

      for await (const part of result.fullStream) {
        if (!assistantMsg.parts) assistantMsg.parts = [];
        const lastPart = assistantMsg.parts.at(-1);
        if (
          lastPart?.type === 'reasoning' &&
          [
            'reasoning-end',
            'text-start',
            'text-delta',
            'tool-input-start',
            'tool-call',
            'finish-step'
          ].includes(part.type)
        ) {
          lastPart.isComplete = true;
        }

        if (part.type === 'text-delta') {
          assistantMsg.content += part.text;
          assistantMsg.currentStep = 'responding';
          appendTextPart(assistantMsg.parts, part.text);
        } else if (part.type === 'reasoning-delta') {
          if (part.text) {
            assistantMsg.reasoning = (assistantMsg.reasoning || '') + part.text;
            appendReasoningPart(assistantMsg.parts, part.text);
          }
          assistantMsg.currentStep = 'thinking';
        } else if (part.type === 'tool-input-start') {
          const toolName = part.toolName as ToolName;
          getOrCreateInvocation(part.id, toolName);
          assistantMsg.currentStep =
            toolName === 'inspect_current_prompt'
              ? 'inspecting'
              : toolName === 'search_animadex' ||
                  toolName === 'retrieve_animadex_tag_by_id' ||
                  toolName === 'search_character_library'
                ? 'searching'
                : toolName === 'queue_generation'
                  ? 'queueing'
                  : 'injecting';
        } else if (part.type === 'tool-call') {
          const toolName = part.toolName as ToolName;
          if (!READ_ONLY_TOOLS.includes(toolName)) {
            const approval = approvals.get(part.toolCallId);
            assistantMsg.currentStep = approval
              ? 'awaiting_approval'
              : assistantMsg.currentStep;
            await approval?.promise;
            continue;
          }
          assistantMsg.currentStep =
            toolName === 'inspect_current_prompt' ? 'inspecting' : 'searching';
          getOrCreateInvocation(
            part.toolCallId,
            toolName,
            'input' in part && part.input
              ? (part.input as Record<string, unknown>)
              : {},
            'applied'
          );
        } else if (part.type === 'tool-result') {
          const existing = assistantMsg.toolInvocations?.find(
            (t) => t.id === part.toolCallId
          );
          if (existing) {
            existing.result = 'output' in part ? part.output : undefined;
            existing.state = READ_ONLY_TOOLS.includes(existing.name)
              ? 'applied'
              : existing.state;
          }
          const partTool = assistantMsg.parts.find(
            (p) => p.type === 'tool' && p.invocation.id === part.toolCallId
          );
          if (partTool && partTool.type === 'tool') {
            partTool.invocation.result =
              'output' in part ? part.output : undefined;
            partTool.invocation.state = READ_ONLY_TOOLS.includes(
              partTool.invocation.name
            )
              ? 'applied'
              : partTool.invocation.state;
          }
          assistantMsg.currentStep = 'tool_completed';
        }
      }
    } catch (err: unknown) {
      if (!assistantMsg.parts) assistantMsg.parts = [];
      if (err instanceof Error && err.name === 'AbortError') {
        const stopNotice = '\n\n*(Generation stopped)*';
        assistantMsg.content += stopNotice;
        appendTextPart(assistantMsg.parts, stopNotice);
      } else {
        const errorMsg =
          err instanceof Error
            ? err.message
            : typeof err === 'string'
              ? err
              : JSON.stringify(err) || 'Unknown error';
        const errNotice = `\n\n**Error:** ${errorMsg}`;
        assistantMsg.content += errNotice;
        appendTextPart(assistantMsg.parts, errNotice);
      }
    } finally {
      for (const part of assistantMsg.parts ?? []) {
        if (part.type === 'reasoning') part.isComplete = true;
      }
      assistantMsg.currentStep = 'done';
      isGenerating.value = false;
      currentAbortController = null;
      session.updatedAt = Date.now();
      void saveChatSessions();
    }
  }

  function resolveApproval(
    messageId: string,
    toolId: string,
    decision: ApprovalDecision
  ) {
    const approval = approvals.get(toolId);
    if (!approval || approval.messageId !== messageId) return;
    approvals.delete(toolId);
    approval.resolve(decision);
  }

  function applyToolInvocation(messageId: string, toolId: string) {
    resolveApproval(messageId, toolId, { action: 'accept' });
  }

  function rejectToolInvocation(messageId: string, toolId: string, note = '') {
    resolveApproval(messageId, toolId, {
      action: 'decline',
      note: note.trim()
    });
  }

  async function init() {
    await Promise.all([loadConfig(), loadChatSessions()]);
    isLoaded.value = true;
    void refreshModels();
  }

  void init();

  return {
    config,
    sessions,
    activeSessionId,
    activeSession,
    activeMessages,
    isDrawerOpen,
    models,
    isLoadingModels,
    isGenerating,
    draftMentions,
    isLoaded,
    hasApiKey,
    selectedModelInfo,
    init,
    loadConfig,
    saveConfig,
    loadChatSessions,
    saveChatSessions,
    createSession,
    switchSession,
    deleteSession,
    renameSession,
    clearAllSessions,
    deleteMessage,
    editMessageAndRegenerate,
    refreshModels,
    sendMessage,
    stopGeneration,
    addDraftMention,
    removeDraftMention,
    toggleDraftMentionImage,
    clearDraftMentions,
    applyToolInvocation,
    rejectToolInvocation
  };
});
