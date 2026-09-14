import {
  computed,
  onBeforeUnmount,
  readonly,
  shallowRef,
  watch,
  type Ref
} from 'vue';
import { toast } from 'vue-sonner';
import { ComfyApi } from '../services/comfyApi';
import { buildWorkflowPrompt } from '../services/workflowBuilder';
import { useComfyStore } from '../stores/comfyStore';
import type { WorkflowState } from '../types/workflow';

const pendingSnapshot = shallowRef<ReturnType<
  typeof createWorkflowSnapshot
> | null>(null);

export function createWorkflowSnapshot(
  state: WorkflowState,
  serverUrl: string
) {
  const id = crypto.randomUUID();
  return {
    id,
    serverUrl: serverUrl.trim().replace(/\/+$/u, ''),
    filename: `koharu-${new Date().toISOString().replaceAll(/[:.]/gu, '-')}-${id}.json`,
    prompt: buildWorkflowPrompt(state)
  };
}

export function useComfyUiWorkspace() {
  function openSnapshot(state: WorkflowState, serverUrl: string) {
    if (pendingSnapshot.value)
      throw new Error('A workflow is already being opened.');
    pendingSnapshot.value = createWorkflowSnapshot(state, serverUrl);
  }

  function finishSnapshot(id: string) {
    if (pendingSnapshot.value?.id === id) pendingSnapshot.value = null;
  }

  return { pending: readonly(pendingSnapshot), openSnapshot, finishSnapshot };
}

export function useComfyUiFrame(
  frame: Ref<HTMLIFrameElement | null>,
  serverUrl: () => string
) {
  const comfyStore = useComfyStore();
  const { pending, finishSnapshot } = useComfyUiWorkspace();
  const baseUrl = computed(() => ComfyApi.cleanUrl(serverUrl()));
  const isOnline = computed(() => comfyStore.isConnected);
  const src = shallowRef('');
  const loading = shallowRef(false);
  const error = shallowRef('');
  const ready = shallowRef(false);
  const bridgeChecking = shallowRef(false);
  const loaded = shallowRef(false);
  const session = shallowRef('');
  const origin = shallowRef('');
  const internalState = {
    generation: 0,
    sentId: '',
    handshakeTimer: undefined as ReturnType<typeof setInterval> | undefined,
    timeout: undefined as ReturnType<typeof setTimeout> | undefined,
    importTimeout: undefined as ReturnType<typeof setTimeout> | undefined
  };

  function finishImport(message?: string) {
    clearTimeout(internalState.importTimeout);
    if (!pending.value) return;
    finishSnapshot(pending.value.id);
    if (message) toast.error(message);
  }

  function resetFrameState() {
    internalState.generation++;
    clearInterval(internalState.handshakeTimer);
    clearTimeout(internalState.timeout);
    clearTimeout(internalState.importTimeout);
    ready.value = false;
    bridgeChecking.value = false;
    loaded.value = false;
    loading.value = false;
    error.value = '';
    src.value = '';
  }

  function sendSnapshot() {
    const request = pending.value;
    if (!request || !ready.value || request.id === internalState.sentId) return;
    if (request.serverUrl !== baseUrl.value) {
      finishImport('The ComfyUI server changed. Open the workflow again.');
      return;
    }
    internalState.sentId = request.id;
    frame.value?.contentWindow?.postMessage(
      {
        channel: 'koharu-workspace',
        session: session.value,
        type: 'import',
        id: request.id,
        filename: request.filename,
        prompt: JSON.parse(JSON.stringify(request.prompt))
      },
      origin.value
    );
    internalState.importTimeout = setTimeout(() => {
      finishImport(
        'Import timed out. Check the ComfyUI tabs before opening another snapshot.'
      );
    }, 60000);
  }

  function onMessage(event: MessageEvent) {
    const data = event.data;
    if (
      event.source !== frame.value?.contentWindow ||
      event.origin !== origin.value ||
      !data ||
      typeof data !== 'object' ||
      data.channel !== 'koharu-workspace' ||
      data.session !== session.value
    )
      return;
    if (data.type === 'ready' && data.id === session.value) {
      clearInterval(internalState.handshakeTimer);
      clearTimeout(internalState.timeout);
      ready.value = true;
      bridgeChecking.value = false;
      loading.value = false;
      sendSnapshot();
    } else if (
      data.type === 'result' &&
      data.id === internalState.sentId &&
      data.id === pending.value?.id &&
      typeof data.ok === 'boolean' &&
      (data.ok || typeof data.error === 'string')
    ) {
      finishImport(data.ok ? undefined : data.error);
      if (data.ok) toast.success('Workflow opened in a new ComfyUI tab.');
    }
  }

  function hello() {
    frame.value?.contentWindow?.postMessage(
      {
        channel: 'koharu-workspace',
        session: session.value,
        type: 'hello',
        id: session.value
      },
      origin.value
    );
  }

  function onLoad() {
    loaded.value = true;
    loading.value = false;
    hello();
  }

  async function reload() {
    if (!comfyStore.isConnected) {
      resetFrameState();
      return;
    }
    const current = ++internalState.generation;
    clearInterval(internalState.handshakeTimer);
    clearTimeout(internalState.timeout);
    if (internalState.sentId && pending.value?.id === internalState.sentId) {
      finishImport(
        'The editor reloaded during import. Check its tabs before opening another snapshot.'
      );
    }
    ready.value = false;
    bridgeChecking.value = true;
    loaded.value = false;
    loading.value = true;
    error.value = '';
    src.value = '';
    session.value = crypto.randomUUID();
    try {
      const url = new URL(baseUrl.value);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password
      ) {
        throw new Error(
          'Use an HTTP or HTTPS ComfyUI server URL without embedded credentials.'
        );
      }
      origin.value = url.origin;
      if (!(await ComfyApi.checkHealth(baseUrl.value)))
        throw new Error(
          'Cannot connect to ComfyUI. Start the server, then retry.'
        );
      if (current !== internalState.generation) return;
      url.searchParams.set('koharuSession', session.value);
      src.value = url.href;
      internalState.handshakeTimer = setInterval(hello, 500);
      internalState.timeout = setTimeout(() => {
        clearInterval(internalState.handshakeTimer);
        bridgeChecking.value = false;
        loading.value = false;
        if (!loaded.value)
          error.value =
            'The ComfyUI page did not load. Check the server and retry.';
        finishImport(
          'Workflow import is unavailable. Update the Koharu Bridge and restart ComfyUI, then retry.'
        );
      }, 30000);
    } catch (cause) {
      if (current !== internalState.generation) return;
      error.value = cause instanceof Error ? cause.message : String(cause);
      bridgeChecking.value = false;
      loading.value = false;
      finishImport(error.value);
    }
  }

  window.addEventListener('message', onMessage);
  watch(
    [baseUrl, () => comfyStore.isConnected],
    ([, connected]) => {
      if (!connected) {
        resetFrameState();
        return;
      }
      void reload();
    },
    { immediate: true }
  );
  watch(pending, () => {
    if (ready.value) sendSnapshot();
    else if (!comfyStore.isConnected)
      finishImport('ComfyUI server is offline. Start the server, then retry.');
    else if (!loading.value && !bridgeChecking.value)
      finishImport(
        error.value ||
          'Update the Koharu Bridge and restart ComfyUI, then reload this editor to import workflows.'
      );
  });
  onBeforeUnmount(() => {
    resetFrameState();
    window.removeEventListener('message', onMessage);
  });

  return {
    src,
    loading,
    error,
    ready,
    bridgeChecking,
    loaded,
    pending,
    isOnline,
    reload,
    onLoad
  };
}
