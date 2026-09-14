import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the shipped extension with only the ComfyUI/browser boundary stubbed.
const source = readFileSync(
  new URL('../../comfyui-koharu-bridge/web/workspace.js', import.meta.url),
  'utf8'
).replace(/^import .*from .*;\s*/u, '');
const session = crypto.randomUUID();
const replies: Record<string, unknown>[] = [];
const calls: unknown[][] = [];
let handler: (event: unknown) => Promise<void>;
let release: (() => void) | undefined;
let fail = false;
const parent = {
  postMessage(data: Record<string, unknown>, origin: string) {
    assert.equal(origin, 'http://localhost:1420');
    replies.push(data);
  }
};
runInNewContext(source, {
  URL,
  window: {
    parent,
    location: { href: `http://127.0.0.1:8188/?koharuSession=${session}` },
    addEventListener(_type: string, listener: typeof handler) {
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
      calls.push(args);
      if (fail) throw new Error('Loader failed');
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
  }
});
const message = (data: Record<string, unknown> = {}, event = {}) =>
  handler({
    source: parent,
    origin: 'http://localhost:1420',
    data: {
      channel: 'koharu-workspace',
      session,
      id: session,
      type: 'hello',
      ...data
    },
    ...event
  });

await message({}, { origin: 'https://untrusted.example' });
await message({}, { source: {} });
await message({ session: crypto.randomUUID() });
await message({ id: 'bad' });
await message({}, { data: null });
assert.equal(replies.length, 0);
await message();
assert.equal(replies.at(-1)?.type, 'ready');

const request = {
  type: 'import',
  id: crypto.randomUUID(),
  filename: 'koharu-test.json',
  prompt: { node_a: { class_type: 'TestNode', inputs: { seed: 42 } } }
};
await message({ ...request, prompt: [] });
assert.equal(replies.at(-1)?.ok, false);
await message({ ...request, filename: '../overwrite.json' });
assert.equal(replies.at(-1)?.ok, false);
assert.equal(calls.length, 0);

const importing = message(request);
await new Promise((resolve) => {
  setTimeout(resolve, 0);
});
await message(request);
assert.equal(calls.length, 1, 'In-flight duplicates must not import twice');
await message({ ...request, id: crypto.randomUUID() });
assert.equal(replies.at(-1)?.ok, false, 'Concurrent imports must not race');
release?.();
await importing;
assert.equal(replies.at(-1)?.ok, true);
assert.equal(calls[0]?.[0], request.prompt);
await message(request);
assert.equal(calls.length, 1, 'Completed duplicates must reuse the result');

await message({
  ...request,
  id: crypto.randomUUID(),
  prompt: { a: { class_type: 'Missing', inputs: {} } }
});
assert.match(String(replies.at(-1)?.error), /Missing custom nodes/u);
assert.equal(
  calls.length,
  1,
  'Missing nodes must be detected before replacing the canvas'
);
fail = true;
await message({ ...request, id: crypto.randomUUID() });
assert.equal(replies.at(-1)?.ok, false);
assert.match(String(replies.at(-1)?.error), /Loader failed/u);
console.log(
  'ComfyUI bridge origin, validation, duplicate, missing-node and failure checks passed'
);
