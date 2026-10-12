/**
 * @vitest-environment happy-dom
 */
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  fetchBooruDetail,
  type BooruPost,
  type BooruPostDetail
} from '@/services/booruGallery';
import { deferred } from '@/test/deferred';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import BooruPostInspector from './BooruPostInspector.vue';

vi.mock(import('@/services/appStorage'), () => ({
  loadAppData: vi.fn(async () => null),
  saveAppData: vi.fn(async () => {}),
  deleteAppData: vi.fn(async () => {})
}));

vi.mock(import('@/services/booruGallery'), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchBooruDetail: vi.fn()
}));

enableAutoUnmount(afterEach);

function post(postId: string): BooruPost {
  return {
    source: 'rule34',
    postId,
    postUrl: '',
    previewUrl: '',
    sampleUrl: '',
    width: 0,
    height: 0,
    rating: 'explicit',
    createdAt: '',
    favorite: null,
    score: 0,
    favCount: 0
  };
}

function detailOf(postId: string): BooruPostDetail {
  return {
    ...post(postId),
    mediaUrl: '',
    fileExt: 'jpg',
    fileSize: 0,
    tags: {},
    complete: true
  };
}

function mountInspector() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const target = document.createElement('div');
  target.id = 'app-content';
  document.body.append(target);
  onTestFinished(() => target.remove());
  const wrapper = mount(
    defineComponent(
      () => () =>
        h(TooltipProvider, () => h(BooruPostInspector, { settings: null }))
    ),
    {
      global: {
        plugins: [
          pinia,
          createRouter({ history: createMemoryHistory(), routes: [] })
        ]
      }
    }
  );
  return wrapper.findComponent(BooruPostInspector).vm;
}

describe('BooruPostInspector', () => {
  it('ignores a detail that finishes after another post was opened', async () => {
    const stale = deferred<BooruPostDetail>();
    const current = deferred<BooruPostDetail>();
    vi.mocked(fetchBooruDetail)
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);
    const inspector = mountInspector();

    void inspector.open(post('111'));
    void inspector.open(post('222'));
    stale.resolve(detailOf('111'));
    await flushPromises();

    expect(document.body.textContent).toContain('#222');
    expect(document.body.textContent).not.toContain('#111');
  });
});
