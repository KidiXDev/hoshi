import { describe, expect, it, vi } from 'vitest';
import type { AiConfig, OpenRouterModel } from '../types/ai';
import {
  DEFAULT_AI_CONFIG,
  getOpenRouterModel,
  profileInstructions,
  supportsReasoning
} from './aiService';

const provider = vi.hoisted(() =>
  vi.fn((modelId: string, settings: Record<string, unknown>) => ({
    modelId,
    settings
  }))
);

vi.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: () => provider
}));

const reasoningModel: OpenRouterModel = {
  id: DEFAULT_AI_CONFIG.selectedModel,
  name: 'Test',
  supported_parameters: ['reasoning']
};

function reasoningSent(
  reasoningEffort: string | undefined,
  model?: OpenRouterModel,
  overrides: Partial<AiConfig> = {}
) {
  const storedConfig = { ...DEFAULT_AI_CONFIG, ...overrides, reasoningEffort };
  getOpenRouterModel(storedConfig as AiConfig, model);
  return provider.mock.lastCall?.[1].reasoning;
}

describe('supportsReasoning', () => {
  it('reads the model capabilities', () => {
    expect(supportsReasoning(reasoningModel)).toBe(true);
    expect(supportsReasoning()).toBe(false);
  });
});

describe('profileInstructions', () => {
  const config: AiConfig = {
    ...DEFAULT_AI_CONFIG,
    customSystemPrompt: 'anima chat',
    enhancerSystemPrompt: 'anima enhance',
    mossCustomSystemPrompt: 'moss chat',
    mossEnhancerSystemPrompt: 'moss enhance'
  };

  it('keeps each profile on its own instructions', () => {
    expect(profileInstructions(config, 'anima')).toEqual({
      assistant: 'anima chat',
      enhancer: 'anima enhance'
    });
    expect(profileInstructions(config, 'moss')).toEqual({
      assistant: 'moss chat',
      enhancer: 'moss enhance'
    });
  });

  it("reuses the profile's assistant instruction for the enhancer when asked", () => {
    const shared = { ...config, enhancerUsesAssistantInstruction: true };

    expect(profileInstructions(shared, 'moss').enhancer).toBe('moss chat');
  });
});

describe('getOpenRouterModel', () => {
  const efforts = [
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh'
  ] as const;

  it.each(efforts)(
    'sends %s effort to a selected reasoning model',
    (effort) => {
      expect(reasoningSent(effort, reasoningModel)).toEqual({ effort });
    }
  );

  it.each(efforts)(
    'omits %s effort when the model cannot be checked',
    (effort) => {
      expect(reasoningSent(effort)).toBeUndefined();
      expect(
        reasoningSent(effort, { ...reasoningModel, supported_parameters: [] })
      ).toBeUndefined();
      expect(
        reasoningSent(effort, reasoningModel, { selectedModel: 'other' })
      ).toBeUndefined();
    }
  );

  it.each(['default', undefined, 'invalid'])(
    'omits the %s effort',
    (effort) => {
      expect(reasoningSent(effort, reasoningModel)).toBeUndefined();
    }
  );
});
