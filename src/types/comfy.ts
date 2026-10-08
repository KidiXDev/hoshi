export interface ComfyPromptResponse {
  prompt_id: string;
  number: number;
  node_errors?: Record<string, unknown>;
}

export interface ComfyHistoryOutput {
  images?: Array<{
    filename: string;
    subfolder: string;
    type: string;
  }>;
  text?: string | string[];
}

export interface ComfyHistoryEntry {
  prompt: [
    number,
    string,
    Record<string, unknown>,
    Record<string, unknown>,
    string[]
  ];
  outputs: Record<string, ComfyHistoryOutput>;
  status?: {
    status_str: string;
    completed: boolean;
    messages: Array<[string, Record<string, unknown>]>;
  };
}

type ComfyQueueItem = [number, string, ...unknown[]];

export interface ComfyQueueResponse {
  queue_running: ComfyQueueItem[];
  queue_pending: ComfyQueueItem[];
}

export interface ComfyObjectInfoNode {
  input: {
    required: Record<string, [string | string[], Record<string, unknown>?]>;
    optional?: Record<string, [string | string[], Record<string, unknown>?]>;
  };
  output: string[];
  output_is_list: boolean[];
  output_name: string[];
  name: string;
  display_name: string;
  description: string;
  category: string;
}

export type ComfyObjectInfo = Record<string, ComfyObjectInfoNode>;

export interface ComfyWsProgressMessage {
  type: 'progress';
  data: {
    value: number;
    max: number;
    prompt_id: string;
    node: string | null;
  };
}

export interface ComfyWsExecutingMessage {
  type: 'executing';
  data: {
    node: string | null;
    display_node?: string;
    prompt_id: string;
  };
}

export interface ComfyWsExecutedMessage {
  type: 'executed';
  data: {
    node: string;
    display_node?: string;
    prompt_id: string;
    output: ComfyHistoryOutput;
  };
}

export interface ComfyWsStatusMessage {
  type: 'status';
  data: {
    status: {
      exec_info: {
        queue_remaining: number;
      };
    };
  };
}

export interface ComfyWsExecutionError {
  type: 'execution_error';
  data: {
    prompt_id: string;
    node_id: string;
    node_type: string;
    executed: string[];
    exception_message: string;
    exception_type: string;
    traceback: string[];
  };
}

export interface ComfyWsExecutionInterrupted {
  type: 'execution_interrupted';
  data: {
    prompt_id: string;
    node_id: string;
    node_type: string;
    executed: string[];
  };
}

export interface BridgeModelsResponse {
  success: boolean;
  checkpoints?: string[];
  unets?: string[];
  loras?: string[];
  vaes?: string[];
  clips?: string[];
  clip_vision?: string[];
  controlnet?: string[];
  upscale_models?: string[];
  embeddings?: string[];
  hypernetworks?: string[];
  ipadapter?: string[];
  gligen?: string[];
  samplers?: string[];
  schedulers?: string[];
  error?: string;
}

export interface BridgeSystemDevice {
  index: number;
  name: string;
  total_vram_mb: number;
  free_vram_mb: number;
  major: number;
  minor: number;
  multi_processor_count: number;
}

export interface BridgeSystemResponse {
  success: boolean;
  python_version: string;
  torch_version: string;
  cuda_available: boolean;
  cuda_version?: string | null;
  devices: BridgeSystemDevice[];
}

export interface ComfyWsGenericMessage {
  type: 'crystools.monitor' | 'progress_state' | string;
  data: unknown;
}

export type ComfyWsMessage =
  | ComfyWsProgressMessage
  | ComfyWsExecutingMessage
  | ComfyWsExecutedMessage
  | ComfyWsStatusMessage
  | ComfyWsExecutionError
  | ComfyWsExecutionInterrupted;
