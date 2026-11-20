import {
  CHARACTER_FIELD,
  formatCharacterTags,
  getCharacterFields,
  getCharacterPreset,
  randomizeCharacterFields,
  type CharacterField,
  type CharacterRating,
  type FieldTags
} from '@/services/characterData';
import { appendPromptTerms } from '@/utils/promptTools';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { toast } from 'vue-sonner';
import { useWorkflowStore } from './workflowStore';

const UNDO_STEPS = 100;
export const MAX_DICE_COUNT = 10;

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
  const busy = ref(false);

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

  let loading: Promise<void> | null = null;
  function load(): Promise<void> {
    loading ??= getCharacterFields()
      .then((defs) => {
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

  function apply(next: FieldTags) {
    history.value = [...history.value, { ...fields.value }].slice(-UNDO_STEPS);
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

  function clearUnlocked() {
    apply(Object.fromEntries(unlockedIds.value.map((id) => [id, []])));
  }

  function undo() {
    const last = history.value.at(-1);
    if (!last) return;
    history.value = history.value.slice(0, -1);
    fields.value = last;
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
    busy,
    fieldIds,
    character,
    tags,
    prompt,
    load,
    setField,
    setCharacter,
    isLocked,
    toggleLock,
    usualLook,
    roll,
    clearUnlocked,
    undo,
    sendToPrompt,
    run
  };
});
