import type { ComfyWsMessage } from '../types/comfy';

export type WsStatusCallback = (connected: boolean) => void;
export type WsMessageCallback = (msg: ComfyWsMessage) => void;
export type WsPreviewCallback = (blobUrl: string) => void;

export class ComfyWsClient {
  private ws: WebSocket | null = null;
  private serverUrl = '';
  private clientId = '';
  private shouldReconnect = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private onStatusChange: WsStatusCallback | null = null;
  private onMessage: WsMessageCallback | null = null;
  private onPreview: WsPreviewCallback | null = null;

  constructor(callbacks?: {
    onStatusChange?: WsStatusCallback;
    onMessage?: WsMessageCallback;
    onPreview?: WsPreviewCallback;
  }) {
    if (callbacks) {
      this.onStatusChange = callbacks.onStatusChange || null;
      this.onMessage = callbacks.onMessage || null;
      this.onPreview = callbacks.onPreview || null;
    }
  }

  public connect(serverUrl: string, clientId: string) {
    this.serverUrl = serverUrl;
    this.clientId = clientId;
    this.shouldReconnect = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }

    const clean = serverUrl.trim().replace(/^http/u, 'ws').replace(/\/+$/u, '');
    const wsUrl = `${clean}/ws?clientId=${encodeURIComponent(clientId)}`;

    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        if (this.onStatusChange) this.onStatusChange(true);
      };

      this.ws.onclose = () => {
        if (this.onStatusChange) this.onStatusChange(false);
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        if (this.onStatusChange) this.onStatusChange(false);
      };

      this.ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          // ComfyUI binary preview frame
          const buffer = event.data;
          if (buffer.byteLength < 8) return;

          const view = new DataView(buffer);
          const eventType = view.getUint32(0, false);

          if (eventType === 1) {
            // PREVIEW_IMAGE: [4 bytes event=1][4 bytes image_type: 1=JPEG, 2=PNG][image bytes...]
            const imageType = view.getUint32(4, false);
            const mime = imageType === 2 ? 'image/png' : 'image/jpeg';
            const imageBytes = buffer.slice(8);
            const blob = new Blob([imageBytes], { type: mime });
            const blobUrl = URL.createObjectURL(blob);
            if (this.onPreview) this.onPreview(blobUrl);
            return;
          } else if (eventType === 4) {
            // PREVIEW_IMAGE_WITH_METADATA: [4 bytes event=4][4 bytes meta_len][meta_len bytes json][image bytes...]
            const metaLength = view.getUint32(4, false);
            if (buffer.byteLength < 8 + metaLength) return;

            let mime = 'image/jpeg';
            try {
              const metaBytes = new Uint8Array(buffer, 8, metaLength);
              const metaStr = new TextDecoder().decode(metaBytes);
              const meta = JSON.parse(metaStr);
              if (meta.image_type) mime = meta.image_type;
            } catch {}

            const imageBytes = buffer.slice(8 + metaLength);
            const blob = new Blob([imageBytes], { type: mime });
            const blobUrl = URL.createObjectURL(blob);
            if (this.onPreview) this.onPreview(blobUrl);
            return;
          }
          return;
        }

        try {
          const msg = JSON.parse(event.data) as ComfyWsMessage;
          if (this.onMessage) this.onMessage(msg);
        } catch {}
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  public disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    this.reconnectTimer = setTimeout(() => {
      if (this.serverUrl && this.clientId && this.shouldReconnect) {
        this.connect(this.serverUrl, this.clientId);
      }
    }, 2000);
  }
}
