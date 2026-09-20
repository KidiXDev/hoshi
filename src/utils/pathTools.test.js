import { describe, expect, test } from 'bun:test';
import { getComfyOutputDir } from './pathTools';

describe('getComfyOutputDir', () => {
  test('handles empty input', () => {
    expect(getComfyOutputDir('')).toBe('');
    expect(getComfyOutputDir('   ')).toBe('');
  });

  test('resolves Linux unix-style paths ending with comfyui', () => {
    expect(getComfyOutputDir('/home/user/ComfyUI')).toBe(
      '/home/user/ComfyUI/output'
    );
    expect(getComfyOutputDir('/home/user/comfyui/')).toBe(
      '/home/user/comfyui/output'
    );
    expect(getComfyOutputDir('/opt/ai/ComfyUI///')).toBe(
      '/opt/ai/ComfyUI/output'
    );
  });

  test('resolves Linux unix-style paths for portable/parent folder', () => {
    expect(getComfyOutputDir('/home/user/ComfyUI_windows_portable')).toBe(
      '/home/user/ComfyUI_windows_portable/ComfyUI/output'
    );
    expect(getComfyOutputDir('/home/user/stable-diffusion')).toBe(
      '/home/user/stable-diffusion/ComfyUI/output'
    );
  });

  test('resolves Windows backslash paths', () => {
    expect(getComfyOutputDir('C:\\ComfyUI')).toBe('C:\\ComfyUI\\output');
    expect(getComfyOutputDir('D:\\AI\\ComfyUI\\')).toBe(
      'D:\\AI\\ComfyUI\\output'
    );
    expect(getComfyOutputDir('C:\\ComfyUI_windows_portable')).toBe(
      'C:\\ComfyUI_windows_portable\\ComfyUI\\output'
    );
  });

  test('resolves Windows forward-slash paths', () => {
    expect(getComfyOutputDir('C:/ComfyUI')).toBe('C:/ComfyUI/output');
    expect(getComfyOutputDir('C:/ComfyUI_windows_portable')).toBe(
      'C:/ComfyUI_windows_portable/ComfyUI/output'
    );
  });
});
