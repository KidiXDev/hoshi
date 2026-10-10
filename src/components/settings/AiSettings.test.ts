/**
 * @vitest-environment happy-dom
 */
import { saveAppData } from '@/services/appStorage';
import { useAiStore } from '@/stores/aiStore';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import AiSettings from './AiSettings.vue';

vi.mock(import('@/services/appStorage'), () => ({
  loadAppData: vi.fn(async () => null),
  saveAppData: vi.fn(async () => {}),
  deleteAppData: vi.fn(async () => {})
}));

vi.mock(import('@/services/aiService'), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchAvailableModels: async () => []
}));

enableAutoUnmount(afterEach);

async function mountSettings() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useAiStore();
  await vi.waitUntil(() => store.isLoaded);
  const wrapper = mount(AiSettings, { global: { plugins: [pinia] } });
  return { store, wrapper, autoApply: wrapper.get('#ai-auto-apply-switch') };
}

describe('AiSettings Auto-Apply switch', () => {
  it('reflects the stored setting', async () => {
    const { store, autoApply } = await mountSettings();
    expect(autoApply.attributes('aria-checked')).toBe('false');

    store.config.autoApply = true;
    await nextTick();

    expect(autoApply.attributes('aria-checked')).toBe('true');
  });

  it('turns Auto-Apply on, saves the config and reports the save', async () => {
    const { store, wrapper, autoApply } = await mountSettings();

    await autoApply.trigger('click');

    expect(store.config.autoApply).toBe(true);
    expect(saveAppData).toHaveBeenCalledWith(
      'ai_config',
      expect.objectContaining({ autoApply: true })
    );
    expect(wrapper.emitted('saved')).toHaveLength(1);
  });
});
