export function getComfyOutputDir(workingDir: string): string {
  const trimmed = workingDir.trim().replace(/[\\/]+$/u, '');
  if (!trimmed) return '';
  const sep = trimmed.includes('\\') ? '\\' : '/';
  return /[\\/]comfyui$/iu.test(trimmed)
    ? `${trimmed}${sep}output`
    : `${trimmed}${sep}ComfyUI${sep}output`;
}
