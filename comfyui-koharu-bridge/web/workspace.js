import { app } from '../../scripts/app.js';

const channel = 'koharu-workspace';
const session = new URL(window.location.href).searchParams.get('koharuSession');
const parentOrigins = new Set([
  'http://localhost:1420',
  'http://127.0.0.1:1420',
  'http://tauri.localhost',
  'https://tauri.localhost',
  'tauri://localhost'
]);
const isId = (value) =>
  typeof value === 'string' && /^[\da-f-]{36}$/iu.test(value);
const isRecord = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

app.registerExtension({
  name: 'Koharu.Workspace',
  setup() {
    if (window.parent === window || !isId(session)) return;
    const requests = new Map();
    let busy = false;

    window.addEventListener('message', async (event) => {
      const data = event.data;
      if (
        event.source !== window.parent ||
        !parentOrigins.has(event.origin) ||
        !isRecord(data) ||
        data.channel !== channel ||
        data.session !== session ||
        !isId(data.id)
      )
        return;

      const reply = (result) =>
        window.parent.postMessage(
          { channel, session, id: data.id, ...result },
          event.origin
        );
      if (data.type === 'hello') {
        // Setup runs before ComfyUI restores its saved workflow tabs.
        if (
          !app.extensionManager?.workflow?.activeWorkflow ||
          app.extensionManager.spinner
        )
          return;
        reply({ type: 'ready' });
        return;
      }
      if (data.type !== 'import') return;
      if (requests.has(data.id)) {
        const result = requests.get(data.id);
        if (result) reply(result);
        return;
      }
      if (busy) {
        reply({
          type: 'result',
          ok: false,
          error: 'Another workflow is being imported.'
        });
        return;
      }
      if (
        typeof data.filename !== 'string' ||
        !/^koharu-[\w.-]+\.json$/u.test(data.filename) ||
        !isRecord(data.prompt) ||
        Object.keys(data.prompt).length === 0 ||
        !Object.values(data.prompt).every(
          (node) =>
            isRecord(node) &&
            typeof node.class_type === 'string' &&
            node.class_type.length > 0 &&
            isRecord(node.inputs)
        )
      ) {
        reply({
          type: 'result',
          ok: false,
          error: 'Invalid workflow snapshot.'
        });
        return;
      }

      requests.set(data.id, null);
      busy = true;
      let result;
      try {
        // Check before loading: some frontend versions return normally for missing nodes.
        const definitions = await app.getNodeDefs();
        const missing = [
          ...new Set(
            Object.values(data.prompt)
              .map((node) => node.class_type)
              .filter((type) => !definitions[type])
          )
        ];
        if (missing.length > 0)
          throw new Error(`Missing custom nodes: ${missing.join(', ')}`);
        await app.loadApiJson(data.prompt, data.filename);
        result = { type: 'result', ok: true };
      } catch (error) {
        result = {
          type: 'result',
          ok: false,
          error: String(error?.message || error)
        };
      } finally {
        busy = false;
      }
      requests.set(data.id, result);
      reply(result);
    });
  }
});
