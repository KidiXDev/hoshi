import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText } from 'ai';
import type { AiConfig, OpenRouterModel } from '../types/ai';
import { http } from './httpClient';

export const DEFAULT_AI_CONFIG: AiConfig = {
  apiKey: '',
  selectedModel: 'deepseek/deepseek-v4-flash-vision-exp',
  titleModel: '',
  customSystemPrompt: '',
  enhancerSystemPrompt: '',
  enhancerUsesAssistantInstruction: false,
  autoApply: false,
  temperature: 0.7,
  contextTokenLimit: 32768,
  maxOutputTokens: 4096,
  reasoningEffort: 'default',
  providerOverride: '',
  allowProviderFallbacks: true
};

import {
  CHAT_TITLE_SYSTEM_PROMPT,
  DEFAULT_ASSISTANT_SYSTEM_PROMPT,
  buildAssistantSystemPrompt
} from '../data/aiPrompts';

export const DEFAULT_SYSTEM_PROMPT = DEFAULT_ASSISTANT_SYSTEM_PROMPT;
export const buildSystemPrompt = buildAssistantSystemPrompt;

export const POPULAR_MODELS: OpenRouterModel[] = [
  {
    id: 'deepseek/deepseek-v4-flash-vision-exp',
    name: 'DeepSeek V4 Flash Vision (Exp)',
    description:
      'High performance multimodal model with vision and prompt engineering capabilities.',
    context_length: 131072,
    architecture: {
      modality: 'text+image->text',
      input_modalities: ['text', 'image'],
      output_modalities: ['text']
    }
  },
  {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    description: 'Ultra-fast multimodal model with strong reasoning & vision.',
    context_length: 1048576,
    pricing: { prompt: '0.00000015', completion: '0.0000006' },
    architecture: {
      modality: 'text+image->text',
      input_modalities: ['text', 'image'],
      output_modalities: ['text']
    }
  },
  {
    id: 'anthropic/claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet',
    description: 'Industry-leading prompt intelligence, nuance, and vision.',
    context_length: 200000,
    pricing: { prompt: '0.000003', completion: '0.000015' },
    architecture: {
      modality: 'text+image->text',
      input_modalities: ['text', 'image'],
      output_modalities: ['text']
    }
  },
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    description: 'High-capability flagship model with vision and tool use.',
    context_length: 128000,
    pricing: { prompt: '0.0000025', completion: '0.00001' },
    architecture: {
      modality: 'text+image->text',
      input_modalities: ['text', 'image'],
      output_modalities: ['text']
    }
  },
  {
    id: 'openai/gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: 'Affordable, fast multimodal model for everyday assistance.',
    context_length: 128000,
    pricing: { prompt: '0.00000015', completion: '0.0000006' },
    architecture: {
      modality: 'text+image->text',
      input_modalities: ['text', 'image'],
      output_modalities: ['text']
    }
  },
  {
    id: 'deepseek/deepseek-chat',
    name: 'DeepSeek V3',
    description: 'Strong open-weights model with excellent prompt generation.',
    context_length: 64000,
    pricing: { prompt: '0.00000014', completion: '0.00000028' },
    architecture: {
      modality: 'text->text',
      input_modalities: ['text'],
      output_modalities: ['text']
    }
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct',
    name: 'Llama 3.3 70B Instruct',
    description: 'High performance open instruct model.',
    context_length: 131072,
    pricing: { prompt: '0.00000012', completion: '0.0000003' },
    architecture: {
      modality: 'text->text',
      input_modalities: ['text'],
      output_modalities: ['text']
    }
  }
];

function stripAuthorPrefix(model: OpenRouterModel): OpenRouterModel {
  return { ...model, name: model.name.replace(/^[^:]+:\s*/u, '') };
}

let cachedModels: OpenRouterModel[] | null = null;
let lastFetchTime = 0;
// 30 minutes cache TTL
const CACHE_TTL_MS = 1000 * 60 * 30;

export async function fetchAvailableModels(
  apiKey?: string,
  forceRefresh = false
): Promise<OpenRouterModel[]> {
  const now = Date.now();
  if (
    !forceRefresh &&
    cachedModels &&
    cachedModels.length > 0 &&
    now - lastFetchTime < CACHE_TTL_MS
  ) {
    return cachedModels;
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (apiKey?.trim()) {
      headers.Authorization = `Bearer ${apiKey.trim()}`;
    }

    const json = await http.get<{ data?: OpenRouterModel[] }>(
      'https://openrouter.ai/api/v1/models',
      { headers }
    );
    if (Array.isArray(json.data) && json.data.length > 0) {
      cachedModels = json.data.map(stripAuthorPrefix);
      lastFetchTime = now;
      return cachedModels;
    }
  } catch (error) {
    console.warn('Error fetching OpenRouter models:', error);
  }

  return cachedModels ?? POPULAR_MODELS;
}

export function getOpenRouterProvider(apiKey: string) {
  return createOpenRouter({
    apiKey: apiKey.trim(),
    headers: {
      'HTTP-Referer': 'https://github.com/KidiXDev/comfy-gui',
      'X-Title': 'ComfyUI Studio'
    }
  });
}

export function supportsReasoning(model?: OpenRouterModel): boolean {
  return model?.supported_parameters?.includes('reasoning') ?? false;
}

export function getOpenRouterModel(config: AiConfig, model?: OpenRouterModel) {
  const provider = getOpenRouterProvider(config.apiKey);
  const settings: Record<string, unknown> = {};
  if (
    model?.id === config.selectedModel &&
    supportsReasoning(model) &&
    config.reasoningEffort &&
    ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(
      config.reasoningEffort
    )
  ) {
    settings.reasoning = { effort: config.reasoningEffort };
  }

  if (config.providerOverride?.trim()) {
    const order = config.providerOverride
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    if (order.length > 0) {
      settings.provider = {
        order,
        allow_fallbacks: config.allowProviderFallbacks ?? true
      };
    }
  }

  return provider(config.selectedModel, settings);
}

/**
 * Generates a short chat title from the first user message using the configured
 * title model (falls back to the default chat model). Returns '' on empty output.
 */
export async function generateChatTitle(
  config: AiConfig,
  firstMessage: string
): Promise<string> {
  const titleModel = config.titleModel?.trim();
  const titleConfig = titleModel
    ? { ...config, selectedModel: titleModel }
    : config;
  const { text } = await generateText({
    model: getOpenRouterModel(titleConfig),
    system: CHAT_TITLE_SYSTEM_PROMPT,
    prompt: firstMessage.slice(0, 2000),
    // Reasoning models burn the whole budget thinking and return '' at 32 tokens.
    maxOutputTokens: 256,
    temperature: 0.3,
    providerOptions: {
      openrouter: { reasoning: { enabled: false } }
    }
  });
  return (
    text
      .replaceAll(/<think>[\s\S]*?<\/think>/gu, '')
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean)
      ?.replaceAll(/^["'`#*\s]+|["'`.!?*\s]+$/gu, '')
      .slice(0, 60) ?? ''
  );
}
