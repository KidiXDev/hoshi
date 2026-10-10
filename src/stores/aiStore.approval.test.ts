import { convertArrayToReadableStream, MockLanguageModelV3 } from 'ai/test';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../test/deferred';
import type { WorkflowState } from '../types/workflow';
import { useAiStore } from './aiStore';
import { useComfyStore } from './comfyStore';
import { useWorkflowStore } from './workflowStore';

type StudioTool =
  'inject_positive_prompt' | 'inject_negative_prompt' | 'queue_generation';

const openRouter = vi.hoisted(() => ({
  model: null as MockLanguageModelV3 | null
}));

vi.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: () => () => openRouter.model
}));

vi.mock(import('../services/aiService'), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchAvailableModels: vi.fn(async () => [])
}));

vi.mock(import('../services/appStorage'), () => ({
  loadAppData: vi.fn(async () => null),
  saveAppData: vi.fn(async () => {}),
  deleteAppData: vi.fn(async () => {})
}));

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 }
};

function modelCalling(toolName: StudioTool) {
  const model = new MockLanguageModelV3({
    doStream: [
      {
        stream: convertArrayToReadableStream([
          {
            type: 'tool-call',
            toolCallId: 'approval',
            toolName,
            input: JSON.stringify(
              toolName === 'queue_generation' ? {} : { prompt: 'updated' }
            )
          },
          {
            type: 'finish',
            finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
            usage
          }
        ])
      },
      {
        stream: convertArrayToReadableStream([
          { type: 'text-start', id: 'answer' },
          { type: 'text-delta', id: 'answer', delta: 'Done' },
          { type: 'text-end', id: 'answer' },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: 'stop' },
            usage
          }
        ])
      }
    ]
  });
  openRouter.model = model;
  return model;
}

const generated = (workflowState: WorkflowState) => ({
  url: 'http://localhost/generated.png',
  filename: 'generated.png',
  subfolder: '',
  type: 'output',
  promptId: 'prompt-1',
  workflowState,
  durationMs: 1
});

const nextMacrotask = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 30);
  });

async function studio() {
  const workflow = useWorkflowStore();
  await workflow.init();
  workflow.positivePrompt = 'original';
  workflow.negativePrompt = 'keep this';

  const comfy = useComfyStore();
  const queueGeneration = vi
    .spyOn(comfy, 'queueGeneration')
    .mockResolvedValue('prompt-1');
  const waitForGeneration = vi
    .spyOn(comfy, 'waitForGeneration')
    .mockResolvedValue(generated(workflow.getFullWorkflowState()));

  const store = useAiStore();
  await vi.waitUntil(() => store.isLoaded);
  store.config.apiKey = 'test-only';
  return { store, workflow, queueGeneration, waitForGeneration };
}

function latestReply(store: ReturnType<typeof useAiStore>) {
  const reply = store.activeMessages.at(-1);
  if (!reply) throw new Error('No assistant reply');
  return reply;
}

async function awaitingApproval(toolName: StudioTool, request: string) {
  const setup = await studio();
  const model = modelCalling(toolName);
  const running = setup.store.sendMessage(request);
  await vi.waitUntil(
    () => setup.store.activeMessages.at(-1)?.currentStep === 'awaiting_approval'
  );
  return { ...setup, model, running, reply: latestReply(setup.store) };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('studio tool approval', () => {
  it('holds the model and the studio until the user decides', async () => {
    const { store, workflow, queueGeneration, model, running } =
      await awaitingApproval('inject_positive_prompt', 'Improve my prompt');
    await nextMacrotask();

    expect(model.doStreamCalls).toHaveLength(1);
    expect(
      model.doStreamCalls[0]?.tools?.map((tool) => tool.name)
    ).not.toContain('inject_prompt');
    expect(workflow.positivePrompt).toBe('original');
    expect(workflow.negativePrompt).toBe('keep this');
    expect(queueGeneration).not.toHaveBeenCalled();

    store.stopGeneration();
    await running;
  });

  it('applies an accepted positive prompt and lets the model continue', async () => {
    const { store, workflow, model, running, reply } = await awaitingApproval(
      'inject_positive_prompt',
      'Improve my prompt'
    );

    store.applyToolInvocation(reply.id, 'approval');
    await running;

    expect(model.doStreamCalls).toHaveLength(2);
    expect(workflow.positivePrompt).toBe('updated');
    expect(workflow.negativePrompt).toBe('keep this');
    expect(store.isGenerating).toBe(false);
  });

  it('keeps the prompt on decline and passes the note to the model', async () => {
    const { store, workflow, model, running, reply } = await awaitingApproval(
      'inject_positive_prompt',
      'Improve my prompt'
    );

    store.rejectToolInvocation(
      reply.id,
      'approval',
      'Keep the original outfit'
    );
    await running;

    expect(workflow.positivePrompt).toBe('original');
    expect(model.doStreamCalls).toHaveLength(2);
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain(
      'Keep the original outfit'
    );
  });

  it('ends the turn without continuing when stopped', async () => {
    const { store, workflow, model, running } = await awaitingApproval(
      'inject_positive_prompt',
      'Improve my prompt'
    );

    store.stopGeneration();
    await running;

    expect(model.doStreamCalls).toHaveLength(1);
    expect(workflow.positivePrompt).toBe('original');
    expect(store.isGenerating).toBe(false);
  });

  it('changes only the negative prompt for a negative prompt request', async () => {
    const { store, workflow, running, reply } = await awaitingApproval(
      'inject_negative_prompt',
      'Change my negative prompt'
    );

    store.applyToolInvocation(reply.id, 'approval');
    await running;

    expect(workflow.positivePrompt).toBe('original');
    expect(workflow.negativePrompt).toBe('updated');
  });

  it('continues after a queued generation finishes', async () => {
    const {
      store,
      workflow,
      queueGeneration,
      waitForGeneration,
      model,
      running,
      reply
    } = await awaitingApproval('queue_generation', 'Generate it');
    const generation = deferred<ReturnType<typeof generated>>();
    waitForGeneration.mockReturnValueOnce(generation.promise);

    store.applyToolInvocation(reply.id, 'approval');
    await vi.waitUntil(() => waitForGeneration.mock.calls.length > 0);
    expect(model.doStreamCalls).toHaveLength(1);

    generation.resolve(generated(workflow.getFullWorkflowState()));
    await running;

    expect(queueGeneration).toHaveBeenCalledTimes(1);
    expect(model.doStreamCalls).toHaveLength(2);
  });
});

describe('Auto Apply', () => {
  it.each([
    ['inject_positive_prompt', 'updated', 'keep this', 0],
    ['inject_negative_prompt', 'original', 'updated', 0],
    ['queue_generation', 'original', 'keep this', 1]
  ] as const)(
    'runs %s without asking',
    async (toolName, positivePrompt, negativePrompt, queued) => {
      const { store, workflow, queueGeneration } = await studio();
      store.config.autoApply = true;
      const model = modelCalling(toolName);

      await store.sendMessage('Apply the requested action');

      expect(model.doStreamCalls).toHaveLength(2);
      expect(workflow.positivePrompt).toBe(positivePrompt);
      expect(workflow.negativePrompt).toBe(negativePrompt);
      expect(queueGeneration).toHaveBeenCalledTimes(queued);
    }
  );

  it.each(['inject_positive_prompt', 'inject_negative_prompt'] as const)(
    'tells the model the %s result is already displayed',
    async (toolName) => {
      const { store } = await studio();
      store.config.autoApply = true;
      const model = modelCalling(toolName);

      await store.sendMessage('Apply the requested action');

      const invocation = latestReply(store).toolInvocations?.[0];
      const result = invocation?.result as { status: string; message: string };
      expect(invocation?.args.prompt).toBe('updated');
      expect(result.status).toBe('applied');
      expect(result.message).toMatch(
        /already displayed.*Confirm briefly without repeating/su
      );
      expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain(
        result.message
      );
    }
  );
});
