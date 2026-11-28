import {
  cancelCharacterDatasetRebuild,
  CHARACTER_FIELD,
  formatCharacterTags,
  getCharacterDatasetStatus,
  getCharacterFields,
  getCharacterPreset,
  randomizeCharacterFields,
  listenToCharacterDatasetRebuild,
  rebuildCharacterDataset,
  type CharacterField,
  type CharacterRating,
  type FieldTags,
  type RebuildProgress,
  type RebuildRequest,
  type RebuildSummary
} from '@/services/characterData';
import { appendPromptTerms } from '@/utils/promptTools';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { toast } from 'vue-sonner';
import { useWorkflowStore } from './workflowStore';

const UNDO_STEPS = 100;
const noop = () => {};
export const MAX_DICE_COUNT = 10;

export type LockPreset = 'identity' | 'outfit' | 'all' | 'none';

const IDENTITY_LOCK_FIELDS = [
  CHARACTER_FIELD,
  'subject',
  'hair',
  'eyes',
  'body'
] as const;

const OUTFIT_LOCK_FIELDS = [
  ...IDENTITY_LOCK_FIELDS,
  'outfit',
  'top',
  'bottom',
  'legwear',
  'accessories'
] as const;

export type RebuildOutcome =
  | { ok: true; summary: RebuildSummary | null }
  | { ok: false; stopped: boolean; message: string };

function cloneFields(source: FieldTags): FieldTags {
  return Object.fromEntries(
    Object.entries(source).map(([key, list]) => [key, [...list]])
  );
}

export const useCharacterHelperStore = defineStore('character-helper', () => {
  const workflow = useWorkflowStore();
  const fieldDefs = ref<CharacterField[]>([]);
  const fields = ref<FieldTags>({});
  const locks = ref<string[]>([]);
  const counts = ref<Record<string, number>>({});
  const rating = ref<CharacterRating>('sensitive');
  const mustInclude = ref<string[]>([]);
  const spaces = ref(true);
  const escape = ref(true);
  const history = ref<FieldTags[]>([]);
  const future = ref<FieldTags[]>([]);
  const busy = ref(false);
  const datasetInstalled = ref<boolean | null>(null);
  const rebuilding = ref(false);
  const rebuildProgress = ref<RebuildProgress | null>(null);
  const rebuildWarnings = ref<string[]>([]);
  const rebuildOutcome = ref<RebuildOutcome | null>(null);
  const rebuildStartedAt = ref<number | null>(null);
  const stopping = ref(false);

  const fieldIds = computed(() => fieldDefs.value.map((f) => f.id));
  const unlockedIds = computed(() =>
    fieldIds.value.filter((id) => !locks.value.includes(id))
  );
  const character = computed(() => fields.value[CHARACTER_FIELD]?.[0] ?? '');
  const tags = computed(() =>
    formatCharacterTags(fields.value, {
      spaces: spaces.value,
      escape: escape.value
    })
  );
  const prompt = computed(() => tags.value.join(', '));
  const canUndo = computed(() => history.value.length > 0);
  const canRedo = computed(() => future.value.length > 0);
  const hasCustomCounts = computed(() =>
    fieldDefs.value.some((f) => counts.value[f.id] !== f.count)
  );
  const activeLockPreset = computed<LockPreset | null>(() => {
    const available = new Set(fieldIds.value);
    if (available.size === 0) return null;
    const current = new Set(locks.value.filter((id) => available.has(id)));
    const matches = (target: readonly string[]) => {
      const expected = target.filter((id) => available.has(id));
      return (
        expected.length === current.size &&
        expected.every((id) => current.has(id))
      );
    };
    if (current.size === 0) return 'none';
    if (current.size === available.size) return 'all';
    if (matches(IDENTITY_LOCK_FIELDS)) return 'identity';
    if (matches(OUTFIT_LOCK_FIELDS)) return 'outfit';
    return null;
  });

  let loading: Promise<void> | null = null;
  function load(): Promise<void> {
    loading ??= getCharacterDatasetStatus()
      .then(async (status) => {
        datasetInstalled.value = status.installed && !status.loadError;
        const defs = datasetInstalled.value ? await getCharacterFields() : [];
        fieldDefs.value = defs;
        fields.value = Object.fromEntries(
          defs.map((f) => [f.id, fields.value[f.id] ?? []])
        );
        counts.value = Object.fromEntries(
          defs.map((f) => [f.id, counts.value[f.id] ?? f.count])
        );
      })
      .catch((error) => {
        loading = null;
        throw error;
      });
    return loading;
  }

  async function reload(): Promise<void> {
    loading = null;
    await load();
    locks.value = locks.value.filter((id) => fieldIds.value.includes(id));
    history.value = [];
    future.value = [];
  }

  async function rebuildDataset(
    request: RebuildRequest
  ): Promise<RebuildSummary | null> {
    if (rebuilding.value)
      throw new Error('A dataset rebuild is already running.');
    rebuilding.value = true;
    rebuildProgress.value = null;
    rebuildWarnings.value = [];
    rebuildOutcome.value = null;
    rebuildStartedAt.value = Date.now();
    let stopListening: () => void = noop;
    try {
      stopListening = await listenToCharacterDatasetRebuild({
        progress: (progress) => {
          rebuildProgress.value = progress;
        },
        warning: (message) => {
          if (!rebuildWarnings.value.includes(message))
            rebuildWarnings.value = [...rebuildWarnings.value, message];
        }
      });
      const summary = await rebuildCharacterDataset(request);
      await reload();
      rebuildOutcome.value = { ok: true, summary };
      return summary;
    } catch (error) {
      rebuildOutcome.value = {
        ok: false,
        stopped: stopping.value,
        message: error instanceof Error ? error.message : String(error)
      };
      throw error;
    } finally {
      stopListening();
      rebuilding.value = false;
      stopping.value = false;
      rebuildProgress.value = null;
    }
  }

  async function stopRebuild() {
    stopping.value = true;
    try {
      await cancelCharacterDatasetRebuild();
    } catch (error) {
      stopping.value = false;
      throw error;
    } finally {
      if (!rebuilding.value) stopping.value = false;
    }
  }

  function apply(next: FieldTags) {
    history.value = [...history.value, cloneFields(fields.value)].slice(
      -UNDO_STEPS
    );
    future.value = [];
    fields.value = { ...fields.value, ...next };
  }

  function setField(id: string, value: string[]) {
    fields.value = { ...fields.value, [id]: value };
  }

  function setCharacter(name: string, series?: string) {
    const current = fields.value[CHARACTER_FIELD] ?? [];
    setField(CHARACTER_FIELD, [
      ...new Set([...current, name, ...(series ? [series] : [])])
    ]);
    if (!locks.value.includes(CHARACTER_FIELD))
      locks.value = [...locks.value, CHARACTER_FIELD];
  }

  function isLocked(id: string) {
    return locks.value.includes(id);
  }

  function toggleLock(id: string) {
    locks.value = isLocked(id)
      ? locks.value.filter((l) => l !== id)
      : [...locks.value, id];
  }

  function setGroupLock(ids: string[], locked: boolean) {
    const valid = ids.filter((id) => fieldIds.value.includes(id));
    if (locked) {
      locks.value = [...new Set([...locks.value, ...valid])];
    } else {
      const toRemove = new Set(valid);
      locks.value = locks.value.filter((id) => !toRemove.has(id));
    }
  }

  function applyLockPreset(preset: LockPreset) {
    const available = new Set(fieldIds.value);
    if (preset === 'none') {
      locks.value = [];
    } else if (preset === 'all') {
      locks.value = [...fieldIds.value];
    } else if (preset === 'identity') {
      locks.value = IDENTITY_LOCK_FIELDS.filter((id) => available.has(id));
    } else {
      locks.value = OUTFIT_LOCK_FIELDS.filter((id) => available.has(id));
    }
  }

  function resetCounts() {
    counts.value = Object.fromEntries(
      fieldDefs.value.map((f) => [f.id, f.count])
    );
  }

  async function usualLook() {
    const name = character.value;
    if (!name) throw new Error('Pick a character');
    const preset = await getCharacterPreset(name);
    if (!preset) throw new Error(`No data for ${name}`);
    apply(
      Object.fromEntries(
        unlockedIds.value
          .filter((id) => id !== CHARACTER_FIELD)
          .map((id) => [id, preset.fields[id] ?? []])
      )
    );
  }

  async function roll(ids: string[] = unlockedIds.value) {
    if (ids.length === 0) throw new Error('All fields locked');
    apply(
      await randomizeCharacterFields({
        fields: ids,
        counts: counts.value,
        context: fields.value,
        rating: rating.value,
        require: mustInclude.value
      })
    );
  }

  async function rollGroup(ids: string[]) {
    const target = ids.filter((id) => !locks.value.includes(id));
    if (target.length === 0)
      throw new Error('All fields in this group are locked');
    await roll(target);
  }

  function clearField(id: string) {
    if ((fields.value[id]?.length ?? 0) === 0) return;
    apply({ [id]: [] });
  }

  function clearGroup(ids: string[]) {
    const target = ids.filter(
      (id) => !locks.value.includes(id) && (fields.value[id]?.length ?? 0) > 0
    );
    if (target.length === 0) return;
    apply(Object.fromEntries(target.map((id) => [id, []])));
  }

  function clearUnlocked() {
    const target = unlockedIds.value.filter(
      (id) => (fields.value[id]?.length ?? 0) > 0
    );
    if (target.length === 0) return;
    apply(Object.fromEntries(target.map((id) => [id, []])));
  }

  function undo() {
    const last = history.value.at(-1);
    if (!last) return;
    history.value = history.value.slice(0, -1);
    future.value = [...future.value, cloneFields(fields.value)].slice(
      -UNDO_STEPS
    );
    fields.value = last;
  }

  function redo() {
    const next = future.value.at(-1);
    if (!next) return;
    future.value = future.value.slice(0, -1);
    history.value = [...history.value, cloneFields(fields.value)].slice(
      -UNDO_STEPS
    );
    fields.value = next;
  }

  function sendToPrompt(mode: 'append' | 'replace') {
    if (tags.value.length === 0) return;
    workflow.positivePrompt =
      mode === 'append'
        ? appendPromptTerms(workflow.positivePrompt, tags.value)
        : prompt.value;
    toast.success(
      mode === 'append'
        ? 'Appended to positive prompt'
        : 'Replaced positive prompt'
    );
  }

  async function run(task: () => Promise<void>) {
    busy.value = true;
    try {
      await task();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      busy.value = false;
    }
  }

  return {
    fieldDefs,
    fields,
    locks,
    counts,
    rating,
    mustInclude,
    spaces,
    escape,
    history,
    future,
    busy,
    datasetInstalled,
    rebuilding,
    rebuildProgress,
    rebuildWarnings,
    rebuildOutcome,
    rebuildStartedAt,
    stopping,
    fieldIds,
    unlockedIds,
    character,
    tags,
    prompt,
    canUndo,
    canRedo,
    hasCustomCounts,
    activeLockPreset,
    load,
    reload,
    rebuildDataset,
    stopRebuild,
    setField,
    setCharacter,
    isLocked,
    toggleLock,
    setGroupLock,
    applyLockPreset,
    resetCounts,
    usualLook,
    roll,
    rollGroup,
    clearField,
    clearGroup,
    clearUnlocked,
    undo,
    redo,
    sendToPrompt,
    run
  };
});
