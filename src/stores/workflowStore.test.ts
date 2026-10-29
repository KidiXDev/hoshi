import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAppData, saveAppData } from '../services/appStorage';
import type { LoraItem } from '../types/workflow';
import { normalizeWorkflowState, useWorkflowStore } from './workflowStore';

vi.mock(import('../services/appStorage'), () => ({
  loadAppData: vi.fn(async () => null),
  saveAppData: vi.fn(async () => {}),
  deleteAppData: vi.fn(async () => {})
}));

async function initializedWorkflow() {
  const workflow = useWorkflowStore();
  await workflow.init();
  return workflow;
}

const names = (stack: LoraItem[]) => stack.map((lora) => lora.name);

describe('useWorkflowStore LoRA actions', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('edit only the stack they are given', async () => {
    const workflow = await initializedWorkflow();
    workflow.addLora('generation.safetensors', 1);
    const generation = workflow.loras.map((lora) => ({ ...lora }));
    const detailer: LoraItem[] = [];

    workflow.addLora('face-a.safetensors', 0.8, detailer);
    workflow.addLora('face-b.safetensors', 0.6, detailer);
    workflow.moveLora(1, 'up', detailer);
    expect(names(detailer)).toEqual([
      'face-b.safetensors',
      'face-a.safetensors'
    ]);

    workflow.removeLora('missing', detailer);
    expect(detailer).toHaveLength(2);

    workflow.removeLora(detailer[0]?.id ?? '', detailer);
    expect(names(detailer)).toEqual(['face-a.safetensors']);
    expect(workflow.loras).toEqual(generation);
  });

  it('default to the generation stack', async () => {
    const workflow = await initializedWorkflow();
    workflow.addLora('generation.safetensors', 1);

    workflow.removeLora(workflow.loras[0]?.id ?? '');

    expect(workflow.loras).toEqual([]);
  });

  it('replace or append a LoRA preset on the stack they are given', async () => {
    const workflow = await initializedWorkflow();
    const stack: LoraItem[] = [];
    workflow.addLora('kept.safetensors', 1, stack);
    const preset = {
      loras: [{ name: 'style.safetensors', strength: 0.6, enabled: false }]
    };

    workflow.applyLoraPreset(preset, true, stack);
    expect(names(stack)).toEqual(['kept.safetensors', 'style.safetensors']);
    expect(stack[1]).toMatchObject({ strength: 0.6, enabled: false });

    workflow.applyLoraPreset(preset, false, stack);
    expect(names(stack)).toEqual(['style.safetensors']);
    expect(workflow.loras).toEqual([]);
  });
});

describe('useWorkflowStore prompt presets', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('replace only the prompt they target', async () => {
    const workflow = await initializedWorkflow();
    workflow.positivePrompt = 'old positive';
    workflow.negativePrompt = 'old negative';

    workflow.applyPromptPreset(
      { type: 'both', positive: 'new positive', negative: 'new negative' },
      'positive'
    );

    expect(workflow.positivePrompt).toBe('new positive');
    expect(workflow.negativePrompt).toBe('old negative');
  });

  it('append only the tags the prompt is missing', async () => {
    const workflow = await initializedWorkflow();
    workflow.positivePrompt = 'masterpiece, 1girl';

    workflow.applyPromptPreset(
      { type: 'positive', positive: 'masterpiece, best quality' },
      'both',
      true
    );

    expect(workflow.positivePrompt).toBe('masterpiece, 1girl, best quality');
  });
});

describe('useWorkflowStore profiles', () => {
  const LAYOUT_DRAFT = JSON.stringify({
    width: 1024,
    height: 512,
    bbox_coord_space: 'abs',
    bbox_format: 'xyxy',
    summary: { caption: 'A poster.' },
    items: [{ label: 'object', caption: 'A cup', bbox: [0, 0, 512, 256] }]
  });

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('save the current session and load MOSS defaults on switch', async () => {
    const workflow = await initializedWorkflow();
    workflow.positivePrompt = 'anima prompt';

    await workflow.switchProfile('moss');

    expect(saveAppData).toHaveBeenCalledWith(
      'workflow_session_state',
      expect.objectContaining({
        profile: 'anima',
        positivePrompt: 'anima prompt'
      })
    );
    expect(loadAppData).toHaveBeenCalledWith('workflow_session_state_moss');
    expect(saveAppData).toHaveBeenCalledWith('workflow_profile', 'moss');
    expect(workflow.profile).toBe('moss');
    expect(workflow.sampler).toMatchObject({ steps: 25, cfg: 2.5 });
    expect(workflow.negativePrompt).toBe(
      'nsfw, worst quality, bad anatomy, watermark, jpeg artifact'
    );
  });

  it('switch to the profile of a restored history state', async () => {
    const workflow = await initializedWorkflow();
    workflow.positivePrompt = 'anima prompt';

    workflow.applyWorkflowState(
      normalizeWorkflowState({
        profile: 'moss',
        positivePrompt: 'from history'
      })
    );

    expect(workflow.profile).toBe('moss');
    expect(workflow.positivePrompt).toBe('from history');
    expect(saveAppData).toHaveBeenCalledWith(
      'workflow_session_state',
      expect.objectContaining({ positivePrompt: 'anima prompt' })
    );
    expect(saveAppData).toHaveBeenCalledWith('workflow_profile', 'moss');
  });

  it('import a layout draft into the MOSS layout editor', async () => {
    const workflow = await initializedWorkflow();
    await workflow.switchProfile('moss');

    expect(workflow.applyLayoutDraft(LAYOUT_DRAFT)).toBe(true);

    expect(workflow.positivePrompt).toBe('A poster.');
    expect(workflow.resolution).toMatchObject({
      preset: 'Custom',
      width: 1024,
      height: 512
    });
    expect(workflow.moss.layoutEnabled).toBe(true);
    expect(workflow.moss.layoutBoxes).toMatchObject([
      { kind: 'object', x: 0, y: 0, width: 0.5, height: 0.5, caption: 'A cup' }
    ]);
  });

  it('leave layout drafts alone outside the MOSS profile', async () => {
    const workflow = await initializedWorkflow();

    expect(workflow.applyLayoutDraft(LAYOUT_DRAFT)).toBe(false);
    expect(workflow.moss.layoutBoxes).toEqual([]);
  });
});
