/**
 * @vitest-environment happy-dom
 */
import { TooltipProvider } from '@/components/ui/tooltip';
import { confirmDialogKey } from '@/composables/useConfirmDialog';
import { saveAppData } from '@/services/appStorage';
import { useAiStore } from '@/stores/aiStore';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import AiAssistantDrawer from './AiAssistantDrawer.vue';

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

const AppShell = defineComponent(
  () => () => h(TooltipProvider, () => h(AiAssistantDrawer))
);

function addPortalTarget() {
  const target = document.createElement('div');
  target.id = 'app-content';
  document.body.append(target);
  onTestFinished(() => target.remove());
}

async function mountOpenDrawer() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useAiStore();
  await vi.waitUntil(() => store.isLoaded);
  store.isDrawerOpen = true;
  addPortalTarget();
  const wrapper = mount(AppShell, {
    global: {
      plugins: [
        pinia,
        createRouter({ history: createMemoryHistory(), routes: [] })
      ],
      provide: { [confirmDialogKey]: vi.fn(async () => true) },
      stubs: { AssistantMessage: true, ImageLightboxModal: true }
    }
  });
  return { store, autoApply: wrapper.get('[aria-label="Auto-Apply"]') };
}

describe('AiAssistantDrawer Auto-Apply switch', () => {
  it('reflects the stored setting', async () => {
    const { store, autoApply } = await mountOpenDrawer();
    expect(autoApply.attributes('aria-checked')).toBe('false');

    store.config.autoApply = true;
    await nextTick();

    expect(autoApply.attributes('aria-checked')).toBe('true');
  });

  it('turns Auto-Apply on and saves the config', async () => {
    const { store, autoApply } = await mountOpenDrawer();

    await autoApply.trigger('click');

    expect(store.config.autoApply).toBe(true);
    expect(saveAppData).toHaveBeenCalledWith(
      'ai_config',
      expect.objectContaining({ autoApply: true })
    );
  });
});
