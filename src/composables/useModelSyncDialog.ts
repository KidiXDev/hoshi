import type { UnlistenFn } from '@tauri-apps/api/event';
import { onMounted, onUnmounted, reactive } from 'vue';
import {
  cancelModelSync,
  isCivitaiNotFound,
  onModelHashProgress,
  type LocalModel
} from '../services/modelManager';
import { useSyncModelMutation } from './useModelManagerQueries';

export type ModelSyncStage =
  'idle' | 'hashing' | 'lookup' | 'done' | 'notFound' | 'cancelled' | 'error';

export interface ModelSyncState {
  open: boolean;
  model: LocalModel | null;
  stage: ModelSyncStage;
  processed: number;
  total: number;
  error: string;
  result: LocalModel | null;
}

const TERMINAL: ModelSyncStage[] = ['done', 'notFound', 'cancelled', 'error'];
const CANCELLED = 'CANCELLED';

function hasValidHash(model: LocalModel) {
  return Boolean(
    model.sha256 &&
    model.hashSize === model.fileSize &&
    model.hashModifiedMs === model.modifiedMs
  );
}

/**
 * Drives a single-model Civitai sync behind a non-dismissible, cancelable
 * progress dialog (see `ModelSyncDialog.vue`). Hash progress arrives through
 * the `model-hash-progress` event; cancel flips the Rust-side flag that the
 * hasher checks between chunks.
 */
export function useModelSyncDialog() {
  const sync = useSyncModelMutation();
  const state = reactive<ModelSyncState>({
    open: false,
    model: null,
    stage: 'idle',
    processed: 0,
    total: 0,
    error: '',
    result: null
  });
  let unlisten: UnlistenFn | null = null;

  const isRunning = () => state.stage === 'hashing' || state.stage === 'lookup';
  const isTerminal = () => TERMINAL.includes(state.stage);

  async function run(model: LocalModel): Promise<LocalModel | null> {
    if (isRunning()) return null;
    state.open = true;
    state.model = model;
    state.result = null;
    state.error = '';
    state.processed = 0;
    state.total = model.fileSize;
    state.stage = hasValidHash(model) ? 'lookup' : 'hashing';
    try {
      const result = await sync.mutateAsync(model.id);
      state.result = result;
      state.stage = 'done';
      return result;
    } catch (error) {
      const message = String(error);
      if (message === CANCELLED) state.stage = 'cancelled';
      else if (isCivitaiNotFound(error)) state.stage = 'notFound';
      else {
        state.stage = 'error';
        state.error = message;
      }
      return null;
    }
  }

  function cancel() {
    if (!isRunning()) return;
    void cancelModelSync();
  }

  /** Closes only once the sync has finished; the dialog is not dismissible. */
  function close() {
    if (!isTerminal()) return;
    // Keep the final stage/content while the dialog animates out; `run()`
    // resets everything before the next sync.
    state.open = false;
  }

  onMounted(() => {
    void onModelHashProgress((progress) => {
      if (!state.open || progress.id !== state.model?.id) return;
      state.processed = progress.processed;
      state.total = progress.total;
      if (progress.processed >= progress.total && state.stage === 'hashing') {
        state.stage = 'lookup';
      }
    }).then((stop) => {
      unlisten = stop;
    });
  });

  onUnmounted(() => {
    unlisten?.();
  });

  return { state, run, cancel, close, isRunning, isTerminal };
}
