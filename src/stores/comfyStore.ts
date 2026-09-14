import { defineStore } from 'pinia';
import { computed, ref, shallowRef, watch } from 'vue';
import { queryKeys } from '../composables/queryKeys';
import { queryClient } from '../lib/queryClient';
import { ComfyApi } from '../services/comfyApi';
import { ComfyWsClient } from '../services/comfyWs';
import {
  buildWorkflowPrompt,
  prepareWorkflowForQueue
} from '../services/workflowBuilder';
import type {
  BridgeModelsResponse,
  BridgeSystemResponse,
  ComfyHistoryOutput,
  ComfyObjectInfo,
  ComfyWsExecutedMessage,
  ComfyWsExecutingMessage,
  ComfyWsExecutionError,
  ComfyWsExecutionInterrupted,
  ComfyWsMessage,
  ComfyWsProgressMessage
} from '../types/comfy';
import type { WorkflowState } from '../types/workflow';
import { useHistoryStore } from './historyStore';
import { useLauncherStore } from './launcherStore';

interface PendingGeneration {
  id: string;
  nodes: Record<string, Record<string, unknown>>;
  workflowState: WorkflowState;
  queuedAt: number;
  startedAt?: number;
  image?: {
    filename: string;
    subfolder: string;
    type: string;
  };
}

interface GenerationResult {
  url: string;
  filename: string;
  subfolder: string;
  type: string;
  promptId: string;
  workflowState: WorkflowState;
  durationMs: number;
}

function extractImageFromOutputs(outputs?: Record<string, ComfyHistoryOutput>) {
  if (!outputs) return null;
  for (const output of Object.values(outputs)) {
    if (output.images && output.images.length > 0) {
      return output.images[0];
    }
  }
  return null;
}

function getFriendlyStageName(
  nodeId: string,
  nodeData?: Record<string, unknown>
): string {
  if (nodeData) {
    const classType = String(nodeData['class_type'] || '');
    const meta =
      (nodeData['_meta'] as Record<string, unknown> | undefined) || {};
    const title = String(meta['title'] || '');

    if (
      classType.includes('UNETLoader') ||
      classType.includes('CheckpointLoader')
    ) {
      return 'Loading Model Weights';
    }
    if (
      classType.includes('CLIPLoader') ||
      classType.includes('DualCLIPLoader')
    ) {
      return 'Loading Text Encoder';
    }
    if (classType.includes('VAELoader')) {
      return 'Loading VAE Decoder';
    }
    if (classType.includes('Lora') || classType.includes('LoRA')) {
      return title || 'Applying LoRA Weights';
    }
    if (classType.includes('Prompt') || classType.includes('ClipText')) {
      if (title.toLowerCase().includes('negative'))
        return 'Encoding Negative Prompt';
      if (title.toLowerCase().includes('positive'))
        return 'Encoding Positive Prompt';
      return 'Processing Text Prompts';
    }
    if (classType.includes('EmptyLatent')) {
      return 'Allocating Latent Canvas';
    }
    if (classType.includes('KSampler') || classType.includes('Sampler')) {
      return 'Sampling & Denoising';
    }
    if (classType.includes('VAEDecode')) {
      return 'Decoding Latents to Pixels';
    }
    if (classType.includes('Save') || classType.includes('Preview')) {
      return 'Rendering Final Image';
    }
    if (title && !title.startsWith('Node ')) {
      return title;
    }
  }

  const defaultMap: Record<string, string> = {
    '29': 'Loading Diffusion Model',
    '28': 'Loading CLIP Text Encoder',
    '27': 'Loading VAE Model',
    '21': 'Encoding Positive Prompt',
    '17': 'Encoding Negative Prompt',
    '18': 'Processing Prompt Conditioning',
    '14': 'Preparing Sampling Seed',
    '19': 'Initializing Latent Space',
    '13': 'Configuring Sampling Parameters',
    '9': 'Sampling & Denoising',
    '6': 'Decoding Latents to Pixels',
    '7': 'Finalizing Output Image',
    '8': 'Connecting Metadata'
  };

  if (defaultMap[nodeId]) return defaultMap[nodeId];
  if (nodeId.startsWith('10')) return 'Applying LoRA Adapter';
  return 'Processing Pipeline Graph';
}

function getWorkflowSteps(state: WorkflowState) {
  return state.imageInput.mode === 'inpaint'
    ? state.imageInput.turboEnabled
      ? state.imageInput.turboSteps
      : state.imageInput.inpaintSteps
    : state.sampler.steps;
}

export const useComfyStore = defineStore('comfy', () => {
  const launcherStore = useLauncherStore();
  const historyStore = useHistoryStore();

  const clientId = ref(`koharu-${Math.random().toString(36).slice(2, 10)}`);
  const isConnected = ref(false);
  const isYetEssentialAvailable = ref(false);
  const isChecking = ref(false);
  const objectInfo = shallowRef<ComfyObjectInfo | null>(null);
  const bridgeModels = shallowRef<BridgeModelsResponse | null>(null);
  const bridgeSystem = shallowRef<BridgeSystemResponse | null>(null);
  const isFaceDetailerAvailable = ref(false);
  const isCacheDiTAvailable = ref(false);
  const isUltimateUpscaleAvailable = ref(false);
  const availableBBoxDetectors = ref<string[]>([]);
  const availableSegmDetectors = ref<string[]>([]);

  // Live Execution State
  const isGenerating = ref(false);
  const isQueueing = ref(false);
  const currentPromptId = ref<string | null>(null);
  const pendingGenerationCount = ref(0);
  const queuedGenerationCount = computed(() =>
    Math.max(0, pendingGenerationCount.value - (currentPromptId.value ? 1 : 0))
  );
  const currentNode = ref<string | null>(null);
  const currentNodeTitle = ref<string>('');
  const currentStep = ref(0);
  const maxSteps = ref(0);
  const progressPercent = ref(0);
  const currentPreviewUrl = ref<string | null>(null);
  const lastGeneratedImage = ref<GenerationResult | null>(null);
  const executionError = ref<string | null>(null);
  const generationStartTime = ref<number>(0);
  const currentPromptNodes = ref<Record<string, Record<string, unknown>>>({});

  let wsClient: ComfyWsClient | null = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let healthCheck: Promise<boolean> | null = null;
  const pendingGenerations = new Map<string, PendingGeneration>();
  const generationWaiters = new Map<
    string,
    {
      resolve: (result: GenerationResult) => void;
      reject: (error: Error) => void;
    }
  >();

  // Extracted Available Options from Bridge or ObjectInfo
  const availableCheckpoints = computed<string[]>(() => {
    if (bridgeModels.value?.checkpoints?.length) {
      return bridgeModels.value.checkpoints;
    }
    if (!objectInfo.value) return [];
    const ckptLoader = objectInfo.value['CheckpointLoaderSimple'];
    const ckptInput = ckptLoader?.input?.required?.['ckpt_name'];
    return Array.isArray(ckptInput?.[0]) ? (ckptInput[0] as string[]) : [];
  });

  const availableUnets = computed<string[]>(() => {
    if (bridgeModels.value?.unets?.length) {
      return bridgeModels.value.unets;
    }
    if (!objectInfo.value) return [];
    const unetLoader =
      objectInfo.value['UNETLoader'] ||
      objectInfo.value['CheckpointLoaderSimple'];
    const unetInput =
      unetLoader?.input?.required?.['unet_name'] ||
      unetLoader?.input?.required?.['ckpt_name'];
    return Array.isArray(unetInput?.[0]) ? (unetInput[0] as string[]) : [];
  });

  const availableClips = computed<string[]>(() => {
    if (bridgeModels.value?.clips?.length) {
      return bridgeModels.value.clips;
    }
    if (!objectInfo.value) return [];
    const clipLoader = objectInfo.value['CLIPLoader'];
    const clipInput = clipLoader?.input?.required?.['clip_name'];
    return Array.isArray(clipInput?.[0]) ? (clipInput[0] as string[]) : [];
  });

  const availableVaes = computed<string[]>(() => {
    if (bridgeModels.value?.vaes?.length) {
      return bridgeModels.value.vaes;
    }
    if (!objectInfo.value) return [];
    const vaeLoader = objectInfo.value['VAELoader'];
    const vaeInput = vaeLoader?.input?.required?.['vae_name'];
    return Array.isArray(vaeInput?.[0]) ? (vaeInput[0] as string[]) : [];
  });

  const availableLoras = computed<string[]>(() => {
    if (bridgeModels.value?.loras?.length) {
      return bridgeModels.value.loras;
    }
    if (!objectInfo.value) return [];
    const loraLoader =
      objectInfo.value['YELoadLoraModel'] || objectInfo.value['LoraLoader'];
    const loraInput = loraLoader?.input?.required?.['lora_name'];
    return Array.isArray(loraInput?.[0]) ? (loraInput[0] as string[]) : [];
  });

  const availableUpscaleModels = computed<string[]>(() => {
    if (bridgeModels.value?.upscale_models?.length) {
      return bridgeModels.value.upscale_models;
    }
    if (!objectInfo.value) return [];
    const upscaleLoader =
      objectInfo.value['YEImageUpscale'] ||
      objectInfo.value['UpscaleModelLoader'];
    const upscaleInput =
      upscaleLoader?.input?.required?.['upscale_model'] ||
      upscaleLoader?.input?.required?.['model_name'];
    return Array.isArray(upscaleInput?.[0])
      ? (upscaleInput[0] as string[])
      : [];
  });

  const availableSamplers = computed<string[]>(() => {
    if (bridgeModels.value?.samplers?.length) {
      return bridgeModels.value.samplers;
    }
    if (!objectInfo.value) return [];
    const ksampler = objectInfo.value['KSampler'];
    const samplerInput = ksampler?.input?.required?.['sampler_name'];
    return Array.isArray(samplerInput?.[0])
      ? (samplerInput[0] as string[])
      : [];
  });

  const availableSchedulers = computed<string[]>(() => {
    if (bridgeModels.value?.schedulers?.length) {
      return bridgeModels.value.schedulers;
    }
    if (!objectInfo.value) return [];
    const ksampler = objectInfo.value['KSampler'];
    const schedulerInput = ksampler?.input?.required?.['scheduler'];
    return Array.isArray(schedulerInput?.[0])
      ? (schedulerInput[0] as string[])
      : [];
  });

  function activateGeneration(entry: PendingGeneration) {
    currentPromptId.value = entry.id;
    currentPromptNodes.value = entry.nodes;
    currentNode.value = null;
    currentStep.value = 0;
    maxSteps.value = getWorkflowSteps(entry.workflowState);
    progressPercent.value = 0;
    currentNodeTitle.value = entry.startedAt
      ? 'Initializing Pipeline...'
      : 'Queued in ComfyUI';
    generationStartTime.value = entry.startedAt ?? entry.queuedAt;
    if (currentPreviewUrl.value) {
      URL.revokeObjectURL(currentPreviewUrl.value);
      currentPreviewUrl.value = null;
    }
  }

  function activateNextGeneration() {
    const next = pendingGenerations.values().next().value as
      PendingGeneration | undefined;
    if (next) activateGeneration(next);
    else {
      currentPromptId.value = null;
      currentPromptNodes.value = {};
      currentNode.value = null;
    }
  }

  function publishGenerationImage(entry: PendingGeneration) {
    if (!entry.image) return null;
    if (!isGenerating.value && currentPreviewUrl.value) {
      URL.revokeObjectURL(currentPreviewUrl.value);
      currentPreviewUrl.value = null;
    }
    lastGeneratedImage.value = {
      url: ComfyApi.getViewImageUrl(
        launcherStore.config.serverUrl,
        entry.image.filename,
        entry.image.subfolder,
        entry.image.type
      ),
      ...entry.image,
      promptId: entry.id,
      workflowState: entry.workflowState,
      durationMs: Date.now() - (entry.startedAt ?? entry.queuedAt)
    };
    return lastGeneratedImage.value;
  }

  async function loadGenerationImage(entry: PendingGeneration) {
    if (!entry.image) {
      try {
        const history = await ComfyApi.fetchHistory(
          launcherStore.config.serverUrl,
          entry.id
        );
        entry.image =
          extractImageFromOutputs(history[entry.id]?.outputs) ?? undefined;
      } catch {
        // Executed output remains the fallback.
      }
    }
    return publishGenerationImage(entry);
  }

  async function finishGeneration(
    promptId: string,
    status: 'completed' | 'error' | 'interrupted'
  ) {
    const entry = pendingGenerations.get(promptId);
    if (!entry) return;
    pendingGenerations.delete(promptId);
    pendingGenerationCount.value = pendingGenerations.size;
    isGenerating.value = pendingGenerations.size > 0;

    if (currentPromptId.value === promptId) {
      activateNextGeneration();
      if (!isGenerating.value) {
        progressPercent.value = status === 'completed' ? 100 : 0;
        currentNodeTitle.value =
          status === 'completed'
            ? 'Completed'
            : status === 'interrupted'
              ? 'Interrupted'
              : 'Failed';
      }
    }
    const waiter = generationWaiters.get(promptId);
    generationWaiters.delete(promptId);
    if (status === 'completed') {
      const result = await loadGenerationImage(entry);
      if (result) {
        if (
          !historyStore.items.some(
            (item) =>
              item.promptId === result.promptId &&
              item.filename === result.filename
          )
        ) {
          historyStore.addHistory(
            result.url,
            result.filename,
            result.subfolder,
            result.type,
            result.promptId,
            result.workflowState,
            result.durationMs
          );
        }
        waiter?.resolve(result);
      } else waiter?.reject(new Error('Generation completed without an image'));
    } else {
      waiter?.reject(
        new Error(
          status === 'interrupted'
            ? 'Generation interrupted'
            : 'Generation failed'
        )
      );
    }
  }

  function waitForGeneration(promptId: string, signal?: AbortSignal) {
    const completed = lastGeneratedImage.value;
    if (completed?.promptId === promptId) return Promise.resolve(completed);
    if (!pendingGenerations.has(promptId))
      return Promise.reject(new Error('Generation job not found'));

    return new Promise<GenerationResult>((resolve, reject) => {
      const abort = () => {
        generationWaiters.delete(promptId);
        reject(new DOMException('Generation wait aborted', 'AbortError'));
      };
      generationWaiters.set(promptId, {
        resolve: (result) => {
          signal?.removeEventListener('abort', abort);
          resolve(result);
        },
        reject: (error) => {
          signal?.removeEventListener('abort', abort);
          reject(error);
        }
      });
      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  function handleWsMessage(msg: ComfyWsMessage) {
    if (msg.type === 'status') {
      isConnected.value = true;
    } else if (msg.type === 'executing') {
      const execMsg = msg as ComfyWsExecutingMessage;
      const entry = pendingGenerations.get(execMsg.data.prompt_id);
      if (!entry) return;
      if (!execMsg.data.node) {
        void finishGeneration(entry.id, 'completed');
        return;
      }

      if (!entry.startedAt) entry.startedAt = Date.now();
      if (currentPromptId.value !== entry.id) activateGeneration(entry);
      isGenerating.value = true;
      generationStartTime.value = entry.startedAt;
      currentNode.value = execMsg.data.node;
      const nodeData = entry.nodes[execMsg.data.node];
      currentNodeTitle.value = getFriendlyStageName(
        execMsg.data.node,
        nodeData
      );
    } else if (msg.type === 'progress') {
      const progMsg = msg as ComfyWsProgressMessage;
      if (progMsg.data.prompt_id === currentPromptId.value) {
        currentStep.value = progMsg.data.value;
        maxSteps.value = progMsg.data.max;
        progressPercent.value = Math.round(
          (progMsg.data.value / (progMsg.data.max || 1)) * 100
        );
      }
    } else if (msg.type === 'executed') {
      const execdMsg = msg as ComfyWsExecutedMessage;
      const entry = pendingGenerations.get(execdMsg.data.prompt_id);
      const image = execdMsg.data.output?.images?.[0];
      if (entry && image) entry.image = image;
    } else if (msg.type === 'execution_error') {
      const errorMsg = msg as ComfyWsExecutionError;
      if (pendingGenerations.has(errorMsg.data.prompt_id)) {
        executionError.value =
          errorMsg.data.exception_message ||
          'Execution error occurred in ComfyUI node.';
        void finishGeneration(errorMsg.data.prompt_id, 'error');
      }
    } else if (msg.type === 'execution_interrupted') {
      const interruptedMsg = msg as ComfyWsExecutionInterrupted;
      void finishGeneration(interruptedMsg.data.prompt_id, 'interrupted');
    }
  }

  async function checkServerHealth() {
    if (healthCheck) return healthCheck;
    healthCheck = (async () => {
      const wasConnected = isConnected.value;
      const ok = await ComfyApi.checkHealth(launcherStore.config.serverUrl);
      if (launcherStore.processStatus !== 'running') return false;
      isConnected.value = ok;
      if (!ok) {
        isYetEssentialAvailable.value = false;
        isFaceDetailerAvailable.value = false;
        isCacheDiTAvailable.value = false;
        isUltimateUpscaleAvailable.value = false;
      } else if (!wasConnected || !isYetEssentialAvailable.value) {
        if (!wasConnected) {
          wsClient?.connect(launcherStore.config.serverUrl, clientId.value);
        }
        isYetEssentialAvailable.value = await ComfyApi.checkTagAutocomplete(
          launcherStore.config.serverUrl
        );
      }
      if (ok && !objectInfo.value && !bridgeModels.value) {
        void fetchDiscovery();
      }
      return ok;
    })().finally(() => {
      healthCheck = null;
    });
    return healthCheck;
  }

  function init() {
    if (wsClient) wsClient.disconnect();

    wsClient = new ComfyWsClient({
      onStatusChange: (status) => {
        isConnected.value = status;
        if (status && !objectInfo.value && !bridgeModels.value) {
          fetchDiscovery();
        }
      },
      onMessage: handleWsMessage,
      onPreview: (blobUrl) => {
        if (currentPreviewUrl.value) {
          URL.revokeObjectURL(currentPreviewUrl.value);
        }
        currentPreviewUrl.value = blobUrl;
      }
    });

    if (launcherStore.processStatus === 'running') {
      void checkServerHealth();
    }

    // Heartbeat check
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(() => {
      if (launcherStore.processStatus === 'running') {
        void checkServerHealth();
      }
    }, 2500);
  }

  watch(
    () => launcherStore.processStatus,
    (status) => {
      if (status === 'running') {
        void checkServerHealth();
      } else {
        wsClient?.disconnect();
        isConnected.value = false;
        isYetEssentialAvailable.value = false;
        isFaceDetailerAvailable.value = false;
        isCacheDiTAvailable.value = false;
        isUltimateUpscaleAvailable.value = false;
        pendingGenerations.clear();
        for (const waiter of generationWaiters.values())
          waiter.reject(new Error('ComfyUI stopped'));
        generationWaiters.clear();
        pendingGenerationCount.value = 0;
        isGenerating.value = false;
        currentPromptId.value = null;
      }
    }
  );

  async function fetchDiscovery() {
    if (isChecking.value) return;
    isChecking.value = true;
    try {
      const [bridgeData, systemData] = await Promise.allSettled([
        ComfyApi.fetchBridgeModels(launcherStore.config.serverUrl),
        ComfyApi.fetchBridgeSystem(launcherStore.config.serverUrl)
      ]);

      if (bridgeData.status === 'fulfilled' && bridgeData.value) {
        bridgeModels.value = bridgeData.value;
      }
      if (systemData.status === 'fulfilled' && systemData.value) {
        bridgeSystem.value = systemData.value;
      }
      if (!bridgeModels.value) {
        objectInfo.value = await ComfyApi.fetchObjectInfo(
          launcherStore.config.serverUrl
        );
      }

      const [faceDetailerNode, detectorNode, cacheDiTNode, ultimateNode] =
        await Promise.all([
          ComfyApi.fetchNodeInfo(
            launcherStore.config.serverUrl,
            'FaceDetailer'
          ),
          ComfyApi.fetchNodeInfo(
            launcherStore.config.serverUrl,
            'UltralyticsDetectorProvider'
          ),
          ComfyApi.fetchNodeInfo(
            launcherStore.config.serverUrl,
            'CacheDiT_Model_Optimizer'
          ),
          ComfyApi.fetchNodeInfo(
            launcherStore.config.serverUrl,
            'UltimateSDUpscale'
          )
        ]);
      const detectorInput = detectorNode?.input.required.model_name?.[0];
      const detectorModels = Array.isArray(detectorInput) ? detectorInput : [];
      isFaceDetailerAvailable.value = Boolean(faceDetailerNode && detectorNode);
      isCacheDiTAvailable.value = Boolean(cacheDiTNode);
      isUltimateUpscaleAvailable.value = Boolean(ultimateNode);
      availableBBoxDetectors.value = detectorModels.filter((model) =>
        model.startsWith('bbox/')
      );
      availableSegmDetectors.value = detectorModels.filter((model) =>
        model.startsWith('segm/')
      );
    } catch {
      // Server not ready yet
    } finally {
      isChecking.value = false;
    }
  }

  async function refreshModels() {
    await ComfyApi.refreshBridgeModels(launcherStore.config.serverUrl);
    void queryClient.invalidateQueries({
      queryKey: queryKeys.comfy.models(launcherStore.config.serverUrl)
    });
    void queryClient.invalidateQueries({
      queryKey: ['comfy', 'objectInfo', launcherStore.config.serverUrl]
    });
    await fetchDiscovery();
  }

  async function queueGeneration(workflowState: WorkflowState) {
    if (isQueueing.value) return null;
    isQueueing.value = true;
    executionError.value = null;

    try {
      const queuedWorkflowState = prepareWorkflowForQueue(workflowState);
      const promptPayload = buildWorkflowPrompt(queuedWorkflowState);
      const res = await ComfyApi.queuePrompt(
        launcherStore.config.serverUrl,
        promptPayload,
        clientId.value
      );
      const entry: PendingGeneration = {
        id: res.prompt_id,
        nodes: promptPayload as Record<string, Record<string, unknown>>,
        workflowState: queuedWorkflowState,
        queuedAt: Date.now()
      };
      pendingGenerations.set(entry.id, entry);
      pendingGenerationCount.value = pendingGenerations.size;
      isGenerating.value = true;
      if (!currentPromptId.value) {
        lastGeneratedImage.value = null;
        activateGeneration(entry);
      }
      return entry.id;
    } catch (err) {
      executionError.value = err instanceof Error ? err.message : String(err);
      return null;
    } finally {
      isQueueing.value = false;
    }
  }

  async function generateImage(workflowState: WorkflowState) {
    return (await queueGeneration(workflowState)) !== null;
  }

  function onExecutionFinished() {
    if (currentPromptId.value) {
      void finishGeneration(currentPromptId.value, 'completed');
    }
  }

  async function interrupt() {
    if (!currentPromptId.value) return;
    try {
      currentNodeTitle.value = 'Interrupting...';
      await ComfyApi.interrupt(launcherStore.config.serverUrl);
    } catch {
      currentNodeTitle.value = 'Interrupt failed';
    }
  }

  return {
    clientId,
    isConnected,
    isYetEssentialAvailable,
    isChecking,
    objectInfo,
    bridgeModels,
    bridgeSystem,
    isFaceDetailerAvailable,
    isCacheDiTAvailable,
    isUltimateUpscaleAvailable,
    availableBBoxDetectors,
    availableSegmDetectors,
    isGenerating,
    isQueueing,
    pendingGenerationCount,
    queuedGenerationCount,
    currentPromptId,
    currentNode,
    currentNodeTitle,
    currentStep,
    maxSteps,
    progressPercent,
    currentPreviewUrl,
    lastGeneratedImage,
    executionError,
    generationStartTime,
    availableCheckpoints,
    availableUnets,
    availableClips,
    availableVaes,
    availableLoras,
    availableUpscaleModels,
    availableSamplers,
    availableSchedulers,
    init,
    fetchDiscovery,
    refreshModels,
    generateImage,
    queueGeneration,
    waitForGeneration,
    interrupt,
    onExecutionFinished
  };
});
