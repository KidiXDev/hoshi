/**
 * @vitest-environment happy-dom
 */
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { useImageBatch } from './useImageBatch';

class LoadedImage {
  naturalWidth = 640;
  naturalHeight = 480;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  private url = '';

  get src() {
    return this.url;
  }

  set src(url: string) {
    this.url = url;
    queueMicrotask(() => this.onload?.());
  }
}

enableAutoUnmount(afterEach);

function mountBatch() {
  let batch: ReturnType<typeof useImageBatch> | undefined;
  const wrapper = mount(
    defineComponent({
      setup() {
        batch = useImageBatch();
        return () => null;
      }
    })
  );
  if (!batch) throw new Error('useImageBatch did not run');
  return { batch, wrapper };
}

const imageFiles = () => [
  new File(['x'], 'one.png', { type: 'image/png' }),
  new File(['x'], 'two.webp'),
  new File(['x'], 'ignored.txt', { type: 'text/plain' })
];

describe('useImageBatch', () => {
  let previews = 0;
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    previews = 0;
    vi.stubGlobal('Image', LoadedImage);
    vi.spyOn(URL, 'createObjectURL').mockImplementation(
      () => `blob:test-${++previews}`
    );
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectURL);
  });

  it('accepts image files by type or extension and selects the first', () => {
    const { batch } = mountBatch();

    batch.addFiles(imageFiles());

    expect(batch.items.value.map((item) => item.file.name)).toEqual([
      'one.png',
      'two.webp'
    ]);
    expect(batch.activeItem.value?.file.name).toBe('one.png');
  });

  it('reads preview dimensions once the image loads', async () => {
    const { batch } = mountBatch();

    batch.addFiles(imageFiles());
    await flushPromises();

    expect(batch.activeItem.value).toMatchObject({ width: 640, height: 480 });
  });

  it('groups items by status and reports overall progress', () => {
    const { batch } = mountBatch();
    batch.addFiles(imageFiles());
    const [first, second] = batch.items.value;
    if (!first || !second) throw new Error('Expected two batch items');

    first.status = 'done';
    second.status = 'queued';
    expect(batch.overallProgress.value).toBe(50);
    expect(batch.processingItems.value).toEqual([second]);

    second.status = 'error';
    expect(batch.readyItems.value).toEqual([second]);
  });

  it('selects the next item and revokes the preview when removing the active one', () => {
    const { batch } = mountBatch();
    batch.addFiles(imageFiles());
    const active = batch.activeItem.value;
    if (!active) throw new Error('Expected an active item');

    batch.removeItem(active);

    expect(batch.activeItem.value?.file.name).toBe('two.webp');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-1');
  });

  it('releases every preview on unmount and ignores files added afterwards', () => {
    const { batch, wrapper } = mountBatch();
    batch.addFiles(imageFiles());

    wrapper.unmount();
    batch.addFiles([new File(['x'], 'late.png')]);

    expect(batch.items.value).toHaveLength(0);
    expect(revokeObjectURL.mock.calls).toEqual([
      ['blob:test-1'],
      ['blob:test-2']
    ]);
  });
});
