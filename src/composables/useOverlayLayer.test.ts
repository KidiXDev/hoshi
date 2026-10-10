import { describe, expect, it, onTestFinished } from 'vitest';
import { effectScope, nextTick, shallowRef } from 'vue';
import { useOverlayLayer } from './useOverlayLayer';

function overlay() {
  const scope = effectScope();
  onTestFinished(() => scope.stop());
  const open = shallowRef(false);
  const layer = scope.run(() => useOverlayLayer(open));
  if (!layer) throw new Error('useOverlayLayer did not run');
  return { open, ...layer };
}

describe('useOverlayLayer', () => {
  it('stacks the most recently opened overlay on top and blocks the rest', async () => {
    const first = overlay();
    const second = overlay();

    first.open.value = true;
    second.open.value = true;
    await nextTick();

    expect(second.style.value.zIndex).toBeGreaterThan(first.style.value.zIndex);
    expect([first.isTop.value, second.isTop.value]).toEqual([false, true]);
    expect(first.style.value.pointerEvents).toBe('none');
    expect(second.style.value.pointerEvents).toBe('auto');
  });

  it('brings a reopened overlay back to the top', async () => {
    const first = overlay();
    const second = overlay();
    first.open.value = true;
    second.open.value = true;
    await nextTick();

    first.open.value = false;
    await nextTick();
    first.open.value = true;
    await nextTick();

    expect(first.style.value.zIndex).toBeGreaterThan(second.style.value.zIndex);
    expect([first.isTop.value, second.isTop.value]).toEqual([true, false]);
    expect(first.style.value.pointerEvents).toBe('auto');
    expect(second.style.value.pointerEvents).toBe('none');
  });
});
