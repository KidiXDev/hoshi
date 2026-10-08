import {
  TRANSFER_TARGET_LABELS,
  useImageTransferStore,
  type TransferTarget
} from '@/stores/imageTransferStore';
import { useRouter } from 'vue-router';
import { toast } from 'vue-sonner';

export function useImageTransfer() {
  const router = useRouter();
  const transferStore = useImageTransferStore();

  async function sendImageTo(
    target: TransferTarget,
    url: string | undefined,
    filename?: string
  ) {
    if (!url) return;
    try {
      await transferStore.send(target, url, filename);
      await router.push({ name: target });
    } catch (error) {
      toast.error(
        `Could not send the image to ${TRANSFER_TARGET_LABELS[target]}`,
        {
          description: error instanceof Error ? error.message : String(error)
        }
      );
    }
  }

  return { sendImageTo };
}
