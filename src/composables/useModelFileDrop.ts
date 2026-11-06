import { ref, shallowRef } from 'vue';
import { toast } from 'vue-sonner';
import {
  cancelModelSync,
  isModelFileName,
  onModelHashProgress,
  onModelImportProgress,
  type ImportedModels
} from '../services/modelManager';
import {
  useImportModelsMutation,
  useSyncModelMutation
} from './useModelManagerQueries';

const DROP_EFFECT_KEEPING_SOURCE = 'copy';

export interface ModelImportStatus {
  category: string;
  stage: 'moving' | 'syncing' | 'finished';
  file: string;
  position: number;
  total: number;
  copied: number;
  size: number;
  moved: number;
  matched: number;
  issues: { file: string; reason: string }[];
  cancelled: boolean;
  error: string;
}

interface ModelFileDropOptions {
  targetCategory: () => string;
  markBusy: (id: string, busy: boolean) => void;
  onSynced: (id: string) => void;
}

function carriesFiles(event: DragEvent) {
  return event.dataTransfer?.types.includes('Files') ?? false;
}

export function importPercent(status: ModelImportStatus) {
  if (status.stage === 'finished') return 100;
  if (status.total === 0) return 0;
  const fileShare = status.size > 0 ? status.copied / status.size : 0;
  return Math.round(((status.position + fileShare) / status.total) * 100);
}

export function useModelFileDrop({
  targetCategory,
  markBusy,
  onSynced
}: ModelFileDropOptions) {
  const isFileDrag = shallowRef(false);
  const importStatus = ref<ModelImportStatus | null>(null);
  const isImportDialogOpen = shallowRef(false);
  const importModels = useImportModelsMutation();
  const syncModel = useSyncModelMutation();

  async function trackProgress(status: ModelImportStatus) {
    const stops = await Promise.all([
      onModelImportProgress(({ file, position, total, copied, size }) => {
        Object.assign(status, { file, position, total, copied, size });
      }),
      onModelHashProgress(({ processed, total }) => {
        if (status.stage !== 'syncing') return;
        Object.assign(status, { copied: processed, size: total });
      })
    ]);
    return () => {
      for (const stop of stops) stop();
    };
  }

  async function syncImported(
    status: ModelImportStatus,
    models: ImportedModels['imported']
  ) {
    Object.assign(status, { stage: 'syncing', total: models.length });
    for (const [position, { id, file }] of models.entries()) {
      if (status.cancelled) return;
      Object.assign(status, { file, position, copied: 0, size: 0 });
      markBusy(id, true);
      try {
        await syncModel.mutateAsync(id);
        onSynced(id);
        status.matched += 1;
      } catch (error) {
        if (!status.cancelled) {
          status.issues.push({ file, reason: String(error) });
        }
      } finally {
        markBusy(id, false);
      }
    }
  }

  async function importFiles(files: File[], category: string) {
    const models = files.filter((file) => isModelFileName(file.name));
    if (models.length === 0) {
      toast.error('Only model files can be imported');
      return;
    }
    if (category === 'all') {
      toast.error('Drop on a category to choose the folder');
      return;
    }
    importStatus.value = {
      category,
      stage: 'moving',
      file: models[0]?.name ?? '',
      position: 0,
      total: models.length,
      copied: 0,
      size: 0,
      moved: 0,
      matched: 0,
      issues: files
        .filter((file) => !models.includes(file))
        .map((file) => ({ file: file.name, reason: 'Not a model file.' })),
      cancelled: false,
      error: ''
    };
    isImportDialogOpen.value = true;
    const status = importStatus.value;
    let stopTracking: (() => void) | undefined;
    try {
      stopTracking = await trackProgress(status);
      const { imported, skipped } = await importModels.mutateAsync({
        files: models,
        category
      });
      status.moved = imported.length;
      status.issues.push(...skipped);
      if (!status.cancelled) await syncImported(status, imported);
    } catch (error) {
      status.error = String(error);
    } finally {
      stopTracking?.();
      status.stage = 'finished';
    }
  }

  function cancelImport() {
    if (!importStatus.value) return;
    importStatus.value.cancelled = true;
    void cancelModelSync();
  }

  function closeImport() {
    isImportDialogOpen.value = false;
  }

  function onFileDragOver(event: DragEvent) {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = DROP_EFFECT_KEEPING_SOURCE;
    }
    isFileDrag.value = true;
  }

  function onFileDragLeave(event: DragEvent) {
    const root = event.currentTarget as Node;
    if (!root.contains(event.relatedTarget as Node | null)) {
      isFileDrag.value = false;
    }
  }

  function onFileDrop(event: DragEvent) {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    isFileDrag.value = false;
    void importFiles(
      Array.from(event.dataTransfer?.files ?? []),
      targetCategory()
    );
  }

  return {
    isFileDrag,
    importStatus,
    isImportDialogOpen,
    cancelImport,
    closeImport,
    onFileDragOver,
    onFileDragLeave,
    onFileDrop
  };
}
