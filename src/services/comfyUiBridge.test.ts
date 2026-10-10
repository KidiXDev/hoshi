import { flushPromises } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

type Reply = Record<string, unknown>;
type MessageHandler = (event: unknown) => Promise<void>;

const APP_ORIGIN = 'http://localhost:1420';
const workspaceSource = readFileSync(
  new URL('../../comfyui-koharu-bridge/web/workspace.js', import.meta.url),
  'utf8'
).replace(/^import .*from .*;\s*/u, '');

function loadBridge() {
  const session = crypto.randomUUID();
  const replies: Reply[] = [];
  const loadCalls: unknown[][] = [];
  const replyOrigins: string[] = [];
  const pendingLoads: (() => void)[] = [];
  let handler: MessageHandler | undefined;
  let loaderError: Error | undefined;
  const parent = {
    postMessage(data: Reply, origin: string) {
      replyOrigins.push(origin);
      replies.push(data);
    }
  };

  runInNewContext(workspaceSource, {
    URL,
    window: {
      parent,
      location: { href: `http://127.0.0.1:8188/?koharuSession=${session}` },
      addEventListener(_type: string, listener: MessageHandler) {
        handler = listener;
      }
    },
    app: {
      extensionManager: { workflow: { activeWorkflow: {} }, spinner: false },
      registerExtension(extension: { setup: () => void }) {
        extension.setup();
      },
      getNodeDefs: async () => ({ TestNode: {} }),
      async loadApiJson(...args: unknown[]) {
        loadCalls.push(args);
        if (loaderError) throw loaderError;
        await new Promise<void>((resolve) => {
          pendingLoads.push(resolve);
        });
      }
    }
  });

  function send(data: Reply = {}, event: Reply = {}) {
    if (!handler) throw new Error('workspace.js did not register a listener');
    return handler({
      source: parent,
      origin: APP_ORIGIN,
      data: {
        channel: 'koharu-workspace',
        session,
        id: session,
        type: 'hello',
        ...data
      },
      ...event
    });
  }

  return {
    send,
    replies,
    replyOrigins,
    loadCalls,
    lastReply: () => replies.at(-1),
    finishLoads: () => pendingLoads.splice(0).forEach((resolve) => resolve()),
    failLoads: (error: Error) => {
      loaderError = error;
    }
  };
}

const importRequest = () => ({
  type: 'import',
  id: crypto.randomUUID(),
  filename: 'koharu-test.json',
  prompt: { node_a: { class_type: 'TestNode', inputs: { seed: 42 } } }
});

describe('workspace.js bridge', () => {
  it.each([
    ['an untrusted origin', {}, { origin: 'https://untrusted.example' }],
    ['a foreign window', {}, { source: {} }],
    ['another session', { session: crypto.randomUUID() }, {}],
    ['an invalid id', { id: 'bad' }, {}],
    ['an empty payload', {}, { data: null }]
  ])('ignores messages from %s', async (_, data, event) => {
    const bridge = loadBridge();

    await bridge.send(data, event);

    expect(bridge.replies).toEqual([]);
  });

  it('answers hello with ready, only to the app origin', async () => {
    const bridge = loadBridge();

    await bridge.send();

    expect(bridge.lastReply()?.type).toBe('ready');
    expect(bridge.replyOrigins).toEqual([APP_ORIGIN]);
  });

  it.each([
    ['a non-object prompt', { prompt: [] }],
    ['a path in the filename', { filename: '../overwrite.json' }]
  ])('rejects %s without touching the canvas', async (_, override) => {
    const bridge = loadBridge();

    await bridge.send({ ...importRequest(), ...override });

    expect(bridge.lastReply()?.ok).toBe(false);
    expect(bridge.loadCalls).toEqual([]);
  });

  it('imports the prompt once and reuses the result for repeated requests', async () => {
    const bridge = loadBridge();
    const request = importRequest();

    const importing = bridge.send(request);
    await flushPromises();
    await bridge.send(request);
    expect(bridge.loadCalls).toHaveLength(1);

    bridge.finishLoads();
    await importing;
    expect(bridge.lastReply()?.ok).toBe(true);
    expect(bridge.loadCalls[0]?.[0]).toBe(request.prompt);

    await bridge.send(request);
    expect(bridge.loadCalls).toHaveLength(1);
  });

  it('rejects a different import while one is in flight', async () => {
    const bridge = loadBridge();
    const importing = bridge.send(importRequest());
    await flushPromises();

    await bridge.send(importRequest());

    expect(bridge.lastReply()?.ok).toBe(false);
    expect(bridge.loadCalls).toHaveLength(1);
    bridge.finishLoads();
    await importing;
  });

  it('reports missing custom nodes before replacing the canvas', async () => {
    const bridge = loadBridge();

    await bridge.send({
      ...importRequest(),
      prompt: { a: { class_type: 'Missing', inputs: {} } }
    });

    expect(String(bridge.lastReply()?.error)).toMatch(/Missing custom nodes/u);
    expect(bridge.loadCalls).toEqual([]);
  });

  it('reports loader failures', async () => {
    const bridge = loadBridge();
    bridge.failLoads(new Error('Loader failed'));

    await bridge.send(importRequest());

    expect(bridge.lastReply()).toMatchObject({ ok: false });
    expect(String(bridge.lastReply()?.error)).toMatch(/Loader failed/u);
  });
});
