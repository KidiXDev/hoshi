import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoraItem } from '../types/workflow';
import { useWorkflowStore } from './workflowStore';

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
});
