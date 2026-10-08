const IMAGE_FILE_NAME = /\.(?:avif|bmp|gif|jpe?g|png|tiff?|webp)$/iu;

const MIME_EXTENSIONS: Record<string, string> = {
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/tiff': 'tiff',
  'image/webp': 'webp'
};

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_FILE_NAME.test(file.name);
}

export function imageExtension(file: File): string {
  return (
    file.name.match(IMAGE_FILE_NAME)?.[0] ??
    `.${MIME_EXTENSIONS[file.type] ?? 'png'}`
  );
}

export function withFileName(url: string, filename: string): string {
  if (!filename) return url;
  const parsed = new URL(url);
  if (!parsed.searchParams.has('filename'))
    parsed.searchParams.set('filename', filename);
  return parsed.toString();
}

function nameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return (
      parsed.searchParams.get('filename') ||
      decodeURIComponent(parsed.pathname.split('/').pop() ?? '') ||
      'image'
    );
  } catch {
    return 'image';
  }
}

export async function fileFromUrl(url: string, name?: string): Promise<File> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Could not read the image (HTTP ${response.status}).`);
  const blob = await response.blob();
  if (!blob.type.startsWith('image/'))
    throw new Error('The dropped item is not an image.');
  const baseName = name || nameFromUrl(url);
  const filename = IMAGE_FILE_NAME.test(baseName)
    ? baseName
    : `${baseName}.${MIME_EXTENSIONS[blob.type] ?? 'png'}`;
  return new File([blob], filename, { type: blob.type });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function downscaledDataUrl(
  blob: Blob,
  maxSide = 1568
): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && blob.size <= 1_500_000) return await blobToDataUrl(blob);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) return await blobToDataUrl(blob);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.9);
  } finally {
    bitmap.close();
  }
}

export function carriesImage(items: DataTransferItemList): boolean {
  return Array.from(items).some(
    (item) => item.kind === 'file' || item.type === 'text/uri-list'
  );
}

export function imageFilesFromDataTransfer(
  transfer: DataTransfer | null
): Promise<File[]> {
  const files = Array.from(transfer?.files ?? []).filter((file) =>
    isImageFile(file)
  );
  if (files.length > 0) return Promise.resolve(files);
  const url = transfer
    ?.getData('text/uri-list')
    .split(/\r?\n/u)
    .find((line) => line && !line.startsWith('#'));
  return url ? fileFromUrl(url).then((file) => [file]) : Promise.resolve([]);
}
