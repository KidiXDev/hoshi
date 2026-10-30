import { describe, expect, it, vi } from 'vitest';
import type { Router } from 'vue-router';
import { returnTo } from './navigation';

const routerWithPrevious = (back: string | null) =>
  ({
    options: { history: { state: { back } } },
    back: vi.fn(),
    push: vi.fn()
  }) as unknown as Router & {
    back: ReturnType<typeof vi.fn>;
    push: ReturnType<typeof vi.fn>;
  };

describe('returnTo', () => {
  it('goes back when the previous entry is the target page', () => {
    const router = routerWithPrevious('/civitai?q=anima');
    returnTo(router, '/civitai');
    expect(router.back).toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('pushes the target page when the previous entry is elsewhere', () => {
    const router = routerWithPrevious('/workflow');
    returnTo(router, '/civitai');
    expect(router.push).toHaveBeenCalledWith('/civitai');
    expect(router.back).not.toHaveBeenCalled();
  });
});
