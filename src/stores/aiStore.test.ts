import { flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { searchCharacters } from '../services/animadexApi';
import type { ChatMessage, ChatMessagePart } from '../types/ai';
import type {
  AnimaDexCharacter,
  CharacterSearchResponse
} from '../types/animadex';
import { useAiStore } from './aiStore';
import { useWorkflowStore } from './workflowStore';

type StreamPart = { type: string } & Record<string, unknown>;
type ToolExecutor = (input: Record<string, unknown>) => Promise<unknown>;
interface StreamCall {
  system: string;
  messages: { role: string; content: unknown }[];
  tools: Record<string, { execute: ToolExecutor }>;
  temperature: number;
  maxOutputTokens: number;
}

const ai = vi.hoisted(() => ({
  streamText:
    vi.fn<(options: StreamCall) => { fullStream: AsyncIterable<StreamPart> }>()
}));

vi.mock('ai', () => ({
  tool: (definition: unknown) => definition,
  isStepCount: () => () => false,
  streamText: ai.streamText
}));

vi.mock(import('../services/aiService'), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchAvailableModels: vi.fn(async () => []),
  generateChatTitle: vi.fn(async () => 'Generated Title')
}));

vi.mock(import('../services/appStorage'), () => ({
  loadAppData: vi.fn(async () => null),
  saveAppData: vi.fn(async () => {}),
  deleteAppData: vi.fn(async () => {})
}));

vi.mock(import('../services/animadexApi'), async (importOriginal) => ({
  ...(await importOriginal()),
  searchCharacters: vi.fn()
}));

const raidenShogun: AnimaDexCharacter = {
  slug: 'raiden_shogun',
  name: 'Raiden Shogun',
  copyright: 'genshin_impact',
  copyright_name: 'Genshin Impact',
  trigger: 'raiden shogun, genshin impact',
  tags: ['1girl', 'purple hair'],
  count: 1,
  url: 'https://animadex.net/c/raiden_shogun',
  thumb_url: '',
  img_url: '',
  has_image: false
};

const characterPage = (
  results: AnimaDexCharacter[]
): CharacterSearchResponse => ({
  total: results.length,
  page: 1,
  page_size: 20,
  pages: 1,
  results
});

const HELLO_WORLD: StreamPart[] = [
  { type: 'text-delta', text: 'Hello' },
  { type: 'text-delta', text: ' world' }
];

function streamParts(
  parts: StreamPart[],
  afterPart?: (part: StreamPart) => Promise<void>
) {
  ai.streamText.mockImplementation(() => ({
    fullStream: (async function* () {
      for (const part of parts) {
        yield part;
        await afterPart?.(part);
      }
    })()
  }));
}

function lastStreamCall(): StreamCall {
  const call = ai.streamText.mock.lastCall?.[0];
  if (!call) throw new Error('streamText was not called');
  return call;
}

const userTurns = (messages: { role: string; content: unknown }[]) =>
  messages.filter((message) => message.role === 'user').map((m) => m.content);

async function readyStore() {
  const store = useAiStore();
  await vi.waitUntil(() => store.isLoaded);
  store.config.apiKey = 'test-only';
  return store;
}

function latestReply(store: ReturnType<typeof useAiStore>): ChatMessage {
  const reply = store.activeMessages.at(-1);
  if (!reply) throw new Error('No assistant reply');
  return reply;
}

const textOf = (parts: ChatMessagePart[], type: 'text' | 'reasoning') =>
  parts.flatMap((part) => (part.type === type ? [part.text] : [])).join('');

describe('useAiStore.sendMessage', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    streamParts(HELLO_WORLD);
  });

  it('shows reasoning and text while the stream is still running', async () => {
    const store = await readyStore();
    const timeline: Record<string, unknown>[] = [];
    streamParts(
      [
        { type: 'reasoning-delta', text: 'Planning the scene' },
        { type: 'reasoning-end' },
        { type: 'text-delta', text: 'Hello' },
        { type: 'text-delta', text: ' world' },
        { type: 'reasoning-delta', text: 'Final thought' }
      ],
      async (part) => {
        await nextTick();
        const parts = latestReply(store).parts ?? [];
        timeline.push({
          after: part.type,
          generating: store.isGenerating,
          reasoning: textOf(parts, 'reasoning'),
          text: textOf(parts, 'text'),
          openReasoning: parts.some(
            (p) => p.type === 'reasoning' && !p.isComplete
          )
        });
      }
    );

    await store.sendMessage('Hello');

    expect(timeline).toEqual([
      {
        after: 'reasoning-delta',
        generating: true,
        reasoning: 'Planning the scene',
        text: '',
        openReasoning: true
      },
      {
        after: 'reasoning-end',
        generating: true,
        reasoning: 'Planning the scene',
        text: '',
        openReasoning: false
      },
      {
        after: 'text-delta',
        generating: true,
        reasoning: 'Planning the scene',
        text: 'Hello',
        openReasoning: false
      },
      {
        after: 'text-delta',
        generating: true,
        reasoning: 'Planning the scene',
        text: 'Hello world',
        openReasoning: false
      },
      {
        after: 'reasoning-delta',
        generating: true,
        reasoning: 'Planning the sceneFinal thought',
        text: 'Hello world',
        openReasoning: true
      }
    ]);
    const reply = latestReply(store);
    expect(reply.content).toBe('Hello world');
    expect(reply.currentStep).toBe('done');
    expect(
      reply.parts?.every((p) => p.type !== 'reasoning' || p.isComplete)
    ).toBe(true);
    expect(store.isGenerating).toBe(false);
  });

  it('shows a tool card while the model is still writing the tool input', async () => {
    const store = await readyStore();
    let card: unknown;
    streamParts(
      [
        {
          type: 'tool-input-start',
          id: 'draft',
          toolName: 'inject_positive_prompt'
        }
      ],
      async () => {
        await nextTick();
        const reply = latestReply(store);
        card = {
          step: reply.currentStep,
          part: reply.parts?.at(-1)?.type,
          state: reply.toolInvocations?.[0]?.state
        };
      }
    );

    await store.sendMessage('Draft a prompt');

    expect(card).toEqual({
      step: 'injecting',
      part: 'tool',
      state: 'building'
    });
  });

  it('settles read-only tool calls as applied, failed or unfinished', async () => {
    const store = await readyStore();
    streamParts([
      {
        type: 'tool-call',
        toolName: 'inspect_current_prompt',
        toolCallId: 'inspect',
        input: {}
      },
      { type: 'tool-result', toolCallId: 'inspect', output: {} },
      {
        type: 'tool-call',
        toolName: 'search_animadex',
        toolCallId: 'failed-search',
        input: { query: 'raiden' }
      },
      {
        type: 'tool-error',
        toolCallId: 'failed-search',
        error: new Error('offline')
      },
      {
        type: 'tool-call',
        toolName: 'search_character_library',
        toolCallId: 'unfinished-search',
        input: { query: 'raiden' }
      }
    ]);

    await store.sendMessage('Look up Raiden');

    const states = Object.fromEntries(
      (latestReply(store).toolInvocations ?? []).map((inv) => [
        inv.id,
        inv.state
      ])
    );
    expect(states).toEqual({
      inspect: 'applied',
      'failed-search': 'rejected',
      'unfinished-search': 'rejected'
    });
  });

  it('sends the configured sampling settings and keeps tool names out of the system prompt', async () => {
    const store = await readyStore();

    await store.sendMessage('Hello');

    const call = lastStreamCall();
    expect(call.temperature).toBe(store.config.temperature);
    expect(call.maxOutputTokens).toBe(store.config.maxOutputTokens);
    expect(call.system).not.toMatch(
      /inspect_current_prompt|search_animadex|retrieve_animadex_tag_by_id/u
    );
  });

  it('notes a reply cut off by the response token limit', async () => {
    const store = await readyStore();
    streamParts([
      { type: 'reasoning-delta', text: 'Weighing the layout' },
      { type: 'finish', finishReason: 'length' }
    ]);

    await store.sendMessage('Design a poster');

    expect(textOf(latestReply(store).parts ?? [], 'text')).toContain(
      'Reply cut off'
    );
  });

  it('shows a stream error in the reply', async () => {
    const store = await readyStore();
    streamParts([{ type: 'error', error: new Error('Provider overloaded') }]);

    await store.sendMessage('Hello');

    expect(latestReply(store).content).toContain(
      '**Error:** Provider overloaded'
    );
  });

  it('uses only the MOSS-Image prompt and instructions in the MOSS profile', async () => {
    const store = await readyStore();
    store.config.customSystemPrompt = 'Anima-only instruction';
    store.config.mossCustomSystemPrompt = 'MOSS-only instruction';
    useWorkflowStore().profile = 'moss';

    await store.sendMessage('Hello');

    const { system } = lastStreamCall();
    expect(system).toContain('MOSS-only instruction');
    expect(system).not.toContain('Anima-only instruction');
    expect(system).not.toMatch(/\bAnima\b/u);
  });

  it('gives the model Animadex search and lookup tools', async () => {
    const store = await readyStore();
    await store.sendMessage('Hello');
    const { tools } = lastStreamCall();
    vi.mocked(searchCharacters).mockResolvedValue(
      characterPage([raidenShogun])
    );

    await tools.search_animadex?.execute({
      query: 'raiden',
      category: 'characters',
      page: 1
    });
    expect(searchCharacters).toHaveBeenLastCalledWith({
      q: 'raiden',
      page: 1,
      sort: 'count'
    });

    await expect(
      tools.retrieve_animadex_tag_by_id?.execute({ id: 'Raiden_Shogun' })
    ).resolves.toEqual({
      id: 'raiden_shogun',
      name: 'Raiden Shogun',
      copyright: 'Genshin Impact',
      trigger: 'raiden shogun, genshin impact',
      tags: ['1girl', 'purple hair'],
      url: 'https://animadex.net/c/raiden_shogun'
    });
    expect(searchCharacters).toHaveBeenLastCalledWith({
      character: ['Raiden_Shogun'],
      page: 1,
      sort: 'count'
    });
  });

  it('reports an unknown Animadex id to the model as a tool failure', async () => {
    const store = await readyStore();
    await store.sendMessage('Hello');
    vi.mocked(searchCharacters).mockResolvedValue(characterPage([]));

    await expect(
      lastStreamCall().tools.retrieve_animadex_tag_by_id?.execute({
        id: 'nobody'
      })
    ).rejects.toThrow('Animadex character not found: nobody');
  });

  it('does not replay earlier tool calls to the model as text', async () => {
    const store = await readyStore();
    store.activeSession?.messages.push({
      id: 'prior-tool-message',
      role: 'assistant',
      content: 'Prior result',
      createdAt: Date.now(),
      toolInvocations: [
        {
          id: 'prior-tool',
          name: 'inspect_current_prompt',
          args: {},
          state: 'applied',
          timestamp: Date.now()
        }
      ]
    });

    await store.sendMessage('Hello');

    expect(JSON.stringify(lastStreamCall().messages)).not.toContain(
      'inspect_current_prompt'
    );
  });

  it('starts a session when none exists', async () => {
    const store = await readyStore();
    store.sessions = [];

    await store.sendMessage('Hello');

    expect(store.sessions).toHaveLength(1);
    expect(latestReply(store).content).toBe('Hello world');
  });

  it('names a new chat with the generated title', async () => {
    const store = await readyStore();
    store.createSession();

    await store.sendMessage('Please name this chat');
    await flushPromises();

    expect(store.activeSession?.title).toBe('Generated Title');
  });

  it('drops older turns that exceed the context budget', async () => {
    const store = await readyStore();
    store.createSession('Context budget');
    await store.sendMessage('Old context');

    store.config.contextTokenLimit = 1;
    await store.sendMessage('Newest message');

    expect(userTurns(lastStreamCall().messages)).toEqual(['Newest message']);
  });
});

async function conversation(...turns: string[]) {
  const store = await readyStore();
  store.createSession('Edit test');
  for (const turn of turns) await store.sendMessage(turn);
  return store;
}

const userMessages = (store: ReturnType<typeof useAiStore>) =>
  store.activeMessages.filter((message) => message.role === 'user');

describe('useAiStore message editing', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    streamParts(HELLO_WORLD);
  });

  it('regenerates from an edited turn and forgets what followed it', async () => {
    const store = await conversation('First', 'Second');
    const second = userMessages(store).at(-1);
    if (!second) throw new Error('Missing second turn');

    await store.editMessageAndRegenerate(second.id, 'Edited second');

    expect(userMessages(store).map((m) => m.content)).toEqual([
      'First',
      'Edited second'
    ]);
    const sent = lastStreamCall().messages;
    expect(userTurns(sent).at(-1)).toBe('Edited second');
    expect(JSON.stringify(sent)).not.toContain('Second');
  });

  it('deletes a user turn together with its reply', async () => {
    const store = await conversation('First', 'Middle', 'Keep this turn');
    const middle = userMessages(store).find((m) => m.content === 'Middle');
    if (!middle) throw new Error('Missing middle turn');

    store.deleteMessage(middle.id);

    expect(userMessages(store).map((m) => m.content)).toEqual([
      'First',
      'Keep this turn'
    ]);
  });

  it('deletes only the reply when deleting an assistant message', async () => {
    const store = await conversation('Keep this turn');

    store.deleteMessage(latestReply(store).id);

    expect(latestReply(store).content).toBe('Keep this turn');
  });
});
