import assert from 'node:assert/strict';
import { buildEnhancerUserPrompt } from '../src/data/aiPrompts';

const customRequest = 'Change pose into a dynamic running pose.';
const payload = buildEnhancerUserPrompt(true, '1girl, standing', customRequest);

assert.match(payload, /^Rewrite this positive prompt\./u);
assert.match(payload, /<current_prompt>\n1girl, standing\n<\/current_prompt>/u);
assert.match(
  payload,
  new RegExp(`<operation>\\n${customRequest}\\n</operation>`, 'u')
);
assert.doesNotMatch(payload, /<extra_instruction>|<style_reference>/u);

const full = buildEnhancerUserPrompt(
  false,
  '  ',
  'Add blockers.',
  ' no text ',
  ' ink wash '
);
assert.match(full, /negative prompt/u);
assert.match(full, /<current_prompt>\n\(empty\)\n<\/current_prompt>/u);
assert.match(full, /<style_reference>\nink wash\n<\/style_reference>/u);
assert.match(full, /<extra_instruction>\nno text\n<\/extra_instruction>/u);
console.log('Prompt enhancer custom-mode checks passed');
