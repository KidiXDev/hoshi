import { describe, expect, it } from 'vitest';
import {
  buildAssistantSystemPrompt,
  buildEnhancerSystemPrompt,
  buildEnhancerUserPrompt,
  DEFAULT_ASSISTANT_SYSTEM_PROMPT,
  MOSS_ASSISTANT_SYSTEM_PROMPT,
  MOSS_PROMPT_ENHANCER_SYSTEM_PROMPT,
  PROMPT_ENHANCER_SYSTEM_PROMPT
} from './aiPrompts';

describe('DEFAULT_ASSISTANT_SYSTEM_PROMPT', () => {
  it('introduces Maya without leaked reasoning or framing text', () => {
    expect(DEFAULT_ASSISTANT_SYSTEM_PROMPT).toMatch(/You are Maya/u);
    expect(DEFAULT_ASSISTANT_SYSTEM_PROMPT).not.toMatch(
      /Maya's reasoning|Requests in this workspace describe fictional|\bINPUT\b/u
    );
  });
});

describe('buildAssistantSystemPrompt', () => {
  it('appends the trimmed custom instruction without a heading', () => {
    const prompt = buildAssistantSystemPrompt('  Prefer full body shots.  ');
    expect(prompt).toBe(
      `${DEFAULT_ASSISTANT_SYSTEM_PROMPT}\n\nPrefer full body shots.`
    );
    expect(prompt).not.toMatch(/User Preferences/u);
  });

  it('ignores a blank instruction', () => {
    expect(buildAssistantSystemPrompt('   ')).toBe(
      DEFAULT_ASSISTANT_SYSTEM_PROMPT
    );
  });

  it('uses the MOSS-Image guide for the MOSS profile', () => {
    const prompt = buildAssistantSystemPrompt(undefined, 'moss');

    expect(prompt).toBe(MOSS_ASSISTANT_SYSTEM_PROMPT);
    expect(prompt).toMatch(/MOSS-Image Prompting Guide/u);
  });

  it.each([
    ['MOSS assistant', MOSS_ASSISTANT_SYSTEM_PROMPT, /\bAnima\b/u],
    ['MOSS enhancer', MOSS_PROMPT_ENHANCER_SYSTEM_PROMPT, /\bAnima\b/u],
    ['Anima assistant', DEFAULT_ASSISTANT_SYSTEM_PROMPT, /MOSS/u],
    ['Anima enhancer', PROMPT_ENHANCER_SYSTEM_PROMPT, /MOSS/u]
  ])('keeps the %s prompt free of the other model', (_, prompt, other) => {
    expect(prompt).not.toMatch(other);
  });
});

describe('buildEnhancerSystemPrompt', () => {
  it('appends the custom instruction to the MOSS enhancer prompt', () => {
    expect(buildEnhancerSystemPrompt(' Keep it short. ', 'moss')).toBe(
      `${MOSS_PROMPT_ENHANCER_SYSTEM_PROMPT}\n\nKeep it short.`
    );
  });
});

describe('buildEnhancerUserPrompt', () => {
  it('wraps the current prompt and custom operation in tagged sections', () => {
    const operation = 'Change pose into a dynamic running pose.';
    const payload = buildEnhancerUserPrompt(true, '1girl, standing', operation);

    expect(payload).toMatch(/^Rewrite this positive prompt\./u);
    expect(payload).toContain(
      '<current_prompt>\n1girl, standing\n</current_prompt>'
    );
    expect(payload).toContain(`<operation>\n${operation}\n</operation>`);
    expect(payload).not.toMatch(/<extra_instruction>|<style_reference>/u);
  });

  it('marks an empty prompt and includes trimmed optional sections', () => {
    const payload = buildEnhancerUserPrompt(
      false,
      '  ',
      'Add blockers.',
      ' no text ',
      ' ink wash '
    );

    expect(payload).toMatch(/negative prompt/u);
    expect(payload).toContain('<current_prompt>\n(empty)\n</current_prompt>');
    expect(payload).toContain(
      '<style_reference>\nink wash\n</style_reference>'
    );
    expect(payload).toContain(
      '<extra_instruction>\nno text\n</extra_instruction>'
    );
  });
});
