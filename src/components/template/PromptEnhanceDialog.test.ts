/**
 * @vitest-environment happy-dom
 */
import { useAiStore } from '@/stores/aiStore';
import { useWorkflowStore } from '@/stores/workflowStore';
import { deferred } from '@/test/deferred';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, ref } from 'vue';
import PromptEnhanceDialog from './PromptEnhanceDialog.vue';

interface EnhanceCall {
  system: string;
  prompt: string;
  abortSignal: AbortSignal;
}

const ai = vi.hoisted(() => ({
  streamText: vi.fn<
    (options: EnhanceCall) => {
      textStream: AsyncIterable<string>;
      finishReason: Promise<'stop' | 'length'>;
    }
  >()
}));

vi.mock(import('ai'), async (importOriginal) => ({
  ...(await importOriginal()),
  streamText: ai.streamText as unknown as (typeof import('ai'))['streamText']
}));

vi.mock(import('@/services/appStorage'), () => ({
  loadAppData: vi.fn(async () => null),
  saveAppData: vi.fn(async () => {}),
  deleteAppData: vi.fn(async () => {})
}));

vi.mock(import('@/services/aiService'), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchAvailableModels: vi.fn(async () => [])
}));

function lastEnhanceCall(): EnhanceCall {
  const call = ai.streamText.mock.lastCall?.[0];
  if (!call) throw new Error('Enhancer was not called');
  return call;
}

enableAutoUnmount(afterEach);

beforeEach(() => {
  setActivePinia(createPinia());
  ai.streamText.mockImplementation(() => ({
    textStream: (async function* () {
      yield 'refined';
    })(),
    finishReason: Promise.resolve('stop')
  }));
});

async function editor() {
  const store = useAiStore();
  await vi.waitUntil(() => store.isLoaded);
  store.config.apiKey = 'test-only';
  const workflow = useWorkflowStore();
  workflow.positivePrompt = '1girl, portrait';
  workflow.negativePrompt = 'blurry';
  const target = ref<'positive' | 'negative'>('positive');
  const original = computed(() =>
    target.value === 'positive'
      ? workflow.positivePrompt
      : workflow.negativePrompt
  );
  const passthrough = { template: '<div><slot /></div>' };
  const wrapper = mount(
    defineComponent(
      () => () =>
        h(PromptEnhanceDialog, {
          open: true,
          target: target.value,
          originalPrompt: original.value,
          'onUpdate:target': (value: 'positive' | 'negative') => {
            target.value = value;
          }
        })
    ),
    {
      global: {
        stubs: {
          Dialog: passthrough,
          DialogContent: passthrough,
          DialogHeader: passthrough,
          DialogTitle: passthrough,
          DialogDescription: passthrough,
          DialogCloseButton: true,
          ScrollArea: passthrough,
          AiModelSelector: true,
          AiReasoningSelector: true
        }
      }
    }
  );
  const button = (label: string) => {
    const found = wrapper
      .findAll('button')
      .find((candidate) => candidate.text().trim() === label);
    if (!found) throw new Error(`Missing button: ${label}`);
    return found;
  };
  return { store, workflow, wrapper, button };
}

describe('prompt enhancer request flow', () => {
  it('uses the selected target source and current model context', async () => {
    const { workflow, wrapper, button } = await editor();
    workflow.models.unetName = 'moss-image-sft.safetensors';
    workflow.profile = 'moss';
    workflow.resolution.width = 768;
    workflow.resolution.height = 1280;
    workflow.positivePrompt = 'An illustrated poster.';
    workflow.moss.layoutEnabled = true;
    workflow.moss.layoutBoxes = [
      {
        id: 'headline',
        kind: 'text',
        x: 0.1,
        y: 0.05,
        width: 0.8,
        height: 0.12,
        caption: 'Cream serif lettering.',
        text: '夜の庭'
      }
    ];
    await flushPromises();

    await button('Negative').trigger('click');
    await button('Enhance prompt').trigger('click');
    await flushPromises();

    const call = lastEnhanceCall();
    const payload = JSON.parse(call.prompt);
    expect(payload).toMatchObject({
      target: 'negative',
      current_prompt: 'blurry'
    });
    expect(JSON.parse(payload.scene_prompt)).toMatchObject({
      summary: { caption: 'An illustrated poster.' },
      items: [{ label: 'text', text: '夜の庭' }]
    });
    expect(call.system).toContain('Target: MOSS-Image.');
    expect(call.system).toContain(
      '"diffusionModel":"moss-image-sft.safetensors","width":768,"height":1280'
    );
    expect(wrapper.text()).toContain('refined');
  });

  it('prevents applying a truncated response', async () => {
    ai.streamText.mockImplementation(() => ({
      textStream: (async function* () {
        yield 'unfinished';
      })(),
      finishReason: Promise.resolve('length')
    }));
    const { wrapper, button } = await editor();
    await button('Enhance prompt').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Reply cut off');
    expect(button('Replace positive').attributes('disabled')).toBeDefined();
    expect(button('Append').attributes('disabled')).toBeDefined();
  });

  it('prevents applying partial output after a stream failure', async () => {
    ai.streamText.mockImplementationOnce(() => ({
      textStream: (async function* () {
        yield 'unfinished';
        throw new Error('Connection lost');
      })(),
      finishReason: Promise.resolve('stop')
    }));
    const { wrapper, button } = await editor();
    await button('Enhance prompt').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Connection lost');
    expect(button('Replace positive').attributes('disabled')).toBeDefined();
  });

  it('discards an old stream after switching model profiles', async () => {
    const oldChunk = deferred<string>();
    ai.streamText.mockImplementationOnce(() => ({
      textStream: (async function* () {
        yield await oldChunk.promise;
      })(),
      finishReason: Promise.resolve('stop')
    }));
    const { workflow, wrapper, button } = await editor();
    await button('Enhance prompt').trigger('click');
    const signal = lastEnhanceCall().abortSignal;
    workflow.profile = 'moss';
    await flushPromises();
    oldChunk.resolve('stale Anima result');
    await flushPromises();

    expect(signal.aborted).toBe(true);
    expect(wrapper.text()).not.toContain('stale Anima result');
    expect(button('Replace positive').attributes('disabled')).toBeDefined();
  });
});
