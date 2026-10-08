import { mock, test } from 'bun:test';
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';

mock.module('../src/services/appStorage', () => ({
  loadAppData: async () => null,
  saveAppData: async () => {},
  deleteAppData: async () => {}
}));
const { useWorkflowStore } = await import('../src/stores/workflowStore');

test('shared LoRA actions affect only the selected stack', async () => {
  setActivePinia(createPinia());
  const workflow = useWorkflowStore();
  await workflow.init();
  workflow.addLora('generation.safetensors', 1);
  const generation = JSON.stringify(workflow.loras);
  const detailer = [];
  workflow.addLora('face-a.safetensors', 0.8, detailer);
  workflow.addLora('face-b.safetensors', 0.6, detailer);
  workflow.moveLora(1, 'up', detailer);
  assert.equal(detailer[0].name, 'face-b.safetensors');
  workflow.removeLora('missing', detailer);
  assert.equal(detailer.length, 2);
  workflow.removeLora(detailer[0].id, detailer);
  assert.equal(detailer.length, 1);
  assert.equal(detailer[0].name, 'face-a.safetensors');
  assert.equal(JSON.stringify(workflow.loras), generation);
  workflow.removeLora(workflow.loras[0].id);
  assert.equal(workflow.loras.length, 0);
});
