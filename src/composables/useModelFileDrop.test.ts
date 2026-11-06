import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'vue-sonner';
import {
  cancelModelSync,
  onModelImportProgress,
  type ModelImportProgress
} from '../services/modelManager';
import { deferred } from '../test/deferred';
import {
  importPercent,
  useModelFileDrop,
  type ModelImportStatus
} from './useModelFileDrop';

const mutations = vi.hoisted(() => ({
  importFiles: vi.fn(),
  syncModel: vi.fn()
}));

vi.mock('./useModelManagerQueries', () => ({
  useImportModelsMutation: () => ({ mutateAsync: mutations.importFiles }),
  useSyncModelMutation: () => ({ mutateAsync: mutations.syncModel })
}));

vi.mock(import('../services/modelManager'), async (importOriginal) => ({
  ...(await importOriginal()),
  cancelModelSync: vi.fn(),
  onModelHashProgress: vi.fn(async () => () => {}),
  onModelImportProgress: vi.fn(async () => () => {})
}));

vi.mock('vue-sonner', () => ({ toast: { error: vi.fn() } }));

function dropEvent(files: File[], types = ['Files']) {
  return {
    dataTransfer: { types, files, dropEffect: 'none' },
    preventDefault: vi.fn()
  } as unknown as DragEvent;
}

function file(name: string) {
  return new File(['weights'], name);
}

function setup(category = 'loras') {
  const markBusy = vi.fn();
  const onSynced = vi.fn();
  const drop = useModelFileDrop({
    targetCategory: () => category,
    markBusy,
    onSynced
  });
  return { ...drop, markBusy, onSynced };
}

describe('useModelFileDrop', () => {
  beforeEach(() => {
    mutations.importFiles.mockResolvedValue({ imported: [], skipped: [] });
    mutations.syncModel.mockResolvedValue({});
  });

  it('imports only model files and lists the rest as issues', async () => {
    const model = file('style.safetensors');
    mutations.importFiles.mockResolvedValue({
      imported: [{ id: 'a', file: 'style.safetensors' }],
      skipped: [{ file: 'old.pt', reason: 'Already in this folder.' }]
    });
    const { onFileDrop, importStatus } = setup();

    onFileDrop(dropEvent([model, file('notes.txt')]));
    await flushPromises();

    expect(mutations.importFiles).toHaveBeenCalledWith({
      files: [model],
      category: 'loras'
    });
    expect(importStatus.value).toMatchObject({
      stage: 'finished',
      moved: 1,
      issues: [
        { file: 'notes.txt', reason: 'Not a model file.' },
        { file: 'old.pt', reason: 'Already in this folder.' }
      ]
    });
  });

  it('rejects a drop without model files', async () => {
    const { onFileDrop, importStatus } = setup();

    onFileDrop(dropEvent([file('notes.txt')]));
    await flushPromises();

    expect(mutations.importFiles).not.toHaveBeenCalled();
    expect(importStatus.value).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(
      'Only model files can be imported'
    );
  });

  it('needs a category when All is selected', async () => {
    const { onFileDrop, importStatus } = setup('all');

    onFileDrop(dropEvent([file('style.safetensors')]));
    await flushPromises();

    expect(mutations.importFiles).not.toHaveBeenCalled();
    expect(importStatus.value).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(
      'Drop on a category to choose the folder'
    );
  });

  it('shows byte progress while files move', async () => {
    const pending = deferred<{ imported: []; skipped: [] }>();
    mutations.importFiles.mockReturnValue(pending.promise);
    let report: ((progress: ModelImportProgress) => void) | undefined;
    vi.mocked(onModelImportProgress).mockImplementation(async (handler) => {
      report = handler;
      return () => {};
    });
    const { onFileDrop, importStatus } = setup();

    onFileDrop(dropEvent([file('a.pt'), file('b.pt')]));
    await flushPromises();
    report?.({ file: 'b.pt', position: 1, total: 2, copied: 50, size: 100 });

    expect(importStatus.value).toMatchObject({
      stage: 'moving',
      file: 'b.pt',
      copied: 50,
      size: 100
    });
    pending.resolve({ imported: [], skipped: [] });
    await flushPromises();
  });

  it('syncs each moved model and counts Civitai matches', async () => {
    mutations.importFiles.mockResolvedValue({
      imported: [
        { id: 'a', file: 'a.pt' },
        { id: 'b', file: 'b.pt' }
      ],
      skipped: []
    });
    mutations.syncModel
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('Not found'));
    const { onFileDrop, importStatus, markBusy, onSynced } = setup();

    onFileDrop(dropEvent([file('a.pt'), file('b.pt')]));
    await flushPromises();

    expect(onSynced).toHaveBeenCalledTimes(1);
    expect(onSynced).toHaveBeenCalledWith('a');
    expect(markBusy).toHaveBeenLastCalledWith('b', false);
    expect(importStatus.value).toMatchObject({
      stage: 'finished',
      moved: 2,
      matched: 1,
      issues: [{ file: 'b.pt', reason: 'Error: Not found' }]
    });
  });

  it('finishes with the error when the drop paths cannot be read', async () => {
    mutations.importFiles.mockRejectedValue(new Error('No paths'));
    const { onFileDrop, importStatus } = setup();

    onFileDrop(dropEvent([file('a.pt')]));
    await flushPromises();

    expect(importStatus.value).toMatchObject({
      stage: 'finished',
      error: 'Error: No paths'
    });
  });

  it('stops before syncing when the move was cancelled', async () => {
    const pending = deferred<unknown>();
    mutations.importFiles.mockReturnValue(pending.promise);
    const { onFileDrop, cancelImport, importStatus } = setup();

    onFileDrop(dropEvent([file('a.pt')]));
    await flushPromises();
    cancelImport();
    pending.resolve({ imported: [{ id: 'a', file: 'a.pt' }], skipped: [] });
    await flushPromises();

    expect(cancelModelSync).toHaveBeenCalledOnce();
    expect(mutations.syncModel).not.toHaveBeenCalled();
    expect(importStatus.value).toMatchObject({
      stage: 'finished',
      cancelled: true
    });
  });

  it('keeps the status while closing so the dialog can animate out', async () => {
    const { onFileDrop, closeImport, importStatus, isImportDialogOpen } =
      setup();

    onFileDrop(dropEvent([file('a.pt')]));
    await flushPromises();
    expect(isImportDialogOpen.value).toBe(true);

    closeImport();

    expect(isImportDialogOpen.value).toBe(false);
    expect(importStatus.value).toMatchObject({ stage: 'finished' });
  });

  it('ignores in-app drags so moving models between categories keeps working', () => {
    const { onFileDragOver, onFileDrop, isFileDrag } = setup();
    const event = dropEvent([], ['application/x-koharu-model-id']);

    onFileDragOver(event);
    onFileDrop(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(isFileDrag.value).toBe(false);
  });

  it('tells the OS to keep the source so only Hoshi moves the file', () => {
    const { onFileDragOver, isFileDrag } = setup();
    const event = dropEvent([]);

    onFileDragOver(event);

    expect(event.dataTransfer?.dropEffect).toBe('copy');
    expect(isFileDrag.value).toBe(true);
  });
});

function status(overrides: Partial<ModelImportStatus>) {
  return {
    stage: 'moving',
    position: 0,
    total: 2,
    copied: 0,
    size: 0,
    ...overrides
  } as ModelImportStatus;
}

describe('importPercent', () => {
  it('counts finished files plus the share of the current file', () => {
    expect(importPercent(status({ position: 1, copied: 50, size: 100 }))).toBe(
      75
    );
  });

  it('stays valid before the first size arrives', () => {
    expect(importPercent(status({}))).toBe(0);
    expect(importPercent(status({ total: 0 }))).toBe(0);
  });

  it('is complete once finished', () => {
    expect(importPercent(status({ stage: 'finished' }))).toBe(100);
  });
});
