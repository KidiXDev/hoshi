import { saveImageAs } from '@/services/imageGallery';
import { toast } from 'vue-sonner';

export async function saveImage(url: string | undefined, filename?: string) {
  if (!url) return;
  try {
    const path = await saveImageAs(url, filename || 'image.png');
    if (path) toast.success('Image saved', { description: path });
  } catch (error) {
    toast.error('Could not save the image', { description: String(error) });
  }
}
