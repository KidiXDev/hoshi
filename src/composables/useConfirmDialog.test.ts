import { describe, expect, it } from 'vitest';
import { createConfirmDialog } from './useConfirmDialog';

describe('createConfirmDialog', () => {
  it('opens on confirm and resolves with the user choice', async () => {
    const dialog = createConfirmDialog();
    const confirmed = dialog.confirm({
      title: 'Delete?',
      description: 'Permanent.'
    });
    expect(dialog.open.value).toBe(true);

    dialog.finish(true);

    await expect(confirmed).resolves.toBe(true);
    expect(dialog.open.value).toBe(false);
  });

  it('cancels a pending confirmation when a new one replaces it', async () => {
    const dialog = createConfirmDialog();
    const replaced = dialog.confirm({ title: 'First', description: 'First.' });
    const replacement = dialog.confirm({
      title: 'Second',
      description: 'Second.'
    });

    await expect(replaced).resolves.toBe(false);
    expect(dialog.options.value.title).toBe('Second');

    dialog.finish(false);
    await expect(replacement).resolves.toBe(false);
  });
});
