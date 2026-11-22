<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core';
import {
  Database,
  FileCog,
  FolderOpen,
  FolderSearch,
  Hammer,
  Loader2,
  RotateCcw,
  Square,
  Terminal,
  Trash2
} from '@lucide/vue';
import { useIntervalFn, useNow } from '@vueuse/core';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { toast } from 'vue-sonner';
import NoticeBanner from '@/components/layout/NoticeBanner.vue';
import SettingsSection from '@/components/layout/SettingsSection.vue';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { useConfirmDialog } from '@/composables/useConfirmDialog';
import { usePersistedState } from '@/composables/usePersistedState';
import {
  clearCharacterDatasetDownloads,
  getCharacterDatasetStatus,
  rebuildPercent,
  resetCharacterDataConfig,
  type CharacterDatasetStatus,
  type RebuildProgress
} from '@/services/characterData';
import { useCharacterHelperStore } from '@/stores/characterHelperStore';
import { cleanPath, useLauncherStore } from '@/stores/launcherStore';
import { formatElapsed, formatFileSize } from '@/utils/formatters';

const store = useCharacterHelperStore();
const launcher = useLauncherStore();
const router = useRouter();
const now = useNow({ scheduler: (tick) => useIntervalFn(tick, 1000) });
const count = new Intl.NumberFormat('en');
const { confirm } = useConfirmDialog();
const { state: settings } = usePersistedState(
  'character_helper_settings',
  () => ({ downloadDir: '' }),
  (saved, defaults) => ({
    downloadDir:
      typeof saved.downloadDir === 'string'
        ? saved.downloadDir
        : defaults.downloadDir
  })
);
const status = ref<CharacterDatasetStatus>();
const clearingDownloads = ref(false);

const rebuilding = computed(
  () => store.rebuilding || status.value?.rebuilding === true
);
const detachedRebuild = computed(() => rebuilding.value && !store.rebuilding);
const missingPython = computed(() => !cleanPath(launcher.config.pythonPath));
const installed = computed(
  () => status.value?.installed === true && !status.value.loadError
);
const downloadDir = computed(
  () =>
    cleanPath(settings.value.downloadDir) ||
    status.value?.defaultDownloadDir ||
    ''
);
const progress = computed(() => store.rebuildProgress);
const elapsed = computed(() =>
  store.rebuildStartedAt
    ? formatElapsed((now.value.getTime() - store.rebuildStartedAt) / 1000)
    : ''
);
const outcome = computed(() => store.rebuildOutcome);

function progressDetail({ done, total, unit }: RebuildProgress): string {
  if (done === null) return '';
  if (unit === 'bytes')
    return total
      ? `${formatFileSize(done)} of ${formatFileSize(total)}`
      : formatFileSize(done);
  return total ? `${count.format(done)} of ${count.format(total)}` : '';
}

function summaryText(): string {
  if (!outcome.value?.ok) return '';
  const summary = outcome.value.summary;
  if (!summary) return 'Dataset built.';
  return `Built in ${formatElapsed(summary.seconds)}: ${count.format(summary.tags)} tags, ${count.format(summary.characters)} characters, ${count.format(summary.posts)} dice pictures.`;
}

async function refreshStatus() {
  try {
    status.value = await getCharacterDatasetStatus();
  } catch (error) {
    toast.error('Could not read the Character Helper dataset', {
      description: String(error)
    });
  }
}

function showInFolder(path: string) {
  invoke('show_in_folder', { path }).catch((error) =>
    toast.error('Could not open the folder', { description: String(error) })
  );
}

async function browseDownloadDir() {
  const selected = await invoke<string | null>('pick_directory', {
    title: 'Select a temporary download folder',
    defaultPath: downloadDir.value
  }).catch(() => null);
  if (selected) settings.value.downloadDir = selected;
}

async function rebuild() {
  const comfyRunning = launcher.processStatus === 'running';
  const confirmed = await confirm({
    title: installed.value
      ? 'Rebuild the Character Helper dataset?'
      : 'Build the Character Helper dataset?',
    description: [
      `Downloads about 4 GB into ${downloadDir.value} and deletes it when done.`,
      'Needs about 8 GB of free RAM and takes ten minutes or more.',
      ...(comfyRunning ? ['Stopping ComfyUI first frees RAM.'] : [])
    ].join(' '),
    confirmLabel: installed.value ? 'Rebuild' : 'Build'
  });
  if (!confirmed) return;
  try {
    await store.rebuildDataset({
      workingDir: launcher.config.workingDir,
      pythonPath: launcher.config.pythonPath,
      downloadDir: downloadDir.value
    });
    toast.success('Character Helper dataset built');
  } catch (error) {
    if (store.rebuildOutcome?.ok === false && store.rebuildOutcome.stopped)
      toast.info('Build stopped');
    else toast.error('Build failed', { description: String(error) });
  } finally {
    await refreshStatus();
  }
}

async function stopRebuild() {
  try {
    await store.stopRebuild();
  } catch (error) {
    toast.error('Could not stop the build', { description: String(error) });
  }
  await refreshStatus();
}

async function clearDownloads() {
  clearingDownloads.value = true;
  try {
    await clearCharacterDatasetDownloads(downloadDir.value);
    store.rebuildOutcome = null;
    toast.success('Downloads deleted');
  } catch (error) {
    toast.error('Could not delete the downloads', {
      description: String(error)
    });
  } finally {
    clearingDownloads.value = false;
  }
}

async function resetConfig() {
  const confirmed = await confirm({
    title: 'Reset the field rules and build settings?',
    description:
      'Your edits to field_rules.jsonc and build_settings.jsonc will be lost.',
    confirmLabel: 'Reset'
  });
  if (!confirmed) return;
  try {
    await resetCharacterDataConfig();
    toast.success('Config files reset to defaults');
  } catch (error) {
    toast.error('Could not reset the config files', {
      description: String(error)
    });
  }
}

onMounted(refreshStatus);
</script>

<template>
  <SettingsSection
    title="Character Helper dataset"
    description="Danbooru tag data used by Character Helper."
    icon-class="text-pink-400"
  >
    <template #icon>
      <Database class="h-3.5 w-3.5" />
    </template>

    <div class="border-border/60 bg-muted/20 rounded-lg border p-3">
      <p class="text-foreground text-xs font-medium">Dataset</p>
      <p class="text-muted-foreground mt-1 text-xs">
        <template v-if="!status">Loading…</template>
        <template v-else-if="installed">
          Built{{ status.built ? ` on ${status.built}` : '' }}
        </template>
        <template v-else>Not built yet</template>
      </p>
    </div>

    <NoticeBanner v-if="status?.loadError" tone="destructive">
      {{ status.loadError }}
    </NoticeBanner>

    <Field class="gap-1.5">
      <FieldLabel class="text-foreground text-xs font-medium">
        Download folder
      </FieldLabel>
      <div class="flex items-center gap-2">
        <div class="relative flex-1">
          <FolderOpen
            class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2"
          />
          <Input
            v-model="settings.downloadDir"
            :placeholder="status?.defaultDownloadDir ?? 'System temp folder'"
            :disabled="rebuilding"
            class="text-foreground pl-9 font-mono text-xs"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="iconSm"
          :disabled="!downloadDir"
          title="Open in Explorer"
          class="border-border bg-secondary text-muted-foreground hover:text-foreground h-8 w-8 shrink-0"
          @click="showInFolder(downloadDir)"
        >
          <FolderOpen class="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          :disabled="rebuilding"
          class="border-border bg-secondary text-foreground hover:bg-accent shrink-0 text-xs font-medium"
          @click="browseDownloadDir"
        >
          <FolderSearch class="h-3.5 w-3.5" />
          Browse
        </Button>
      </div>
      <FieldDescription class="text-xs">
        Temporary, needs ~5 GB free. Deleted after a successful build. Empty
        uses the system temp folder.
      </FieldDescription>
    </Field>

    <div
      class="border-border/60 bg-muted/20 flex flex-wrap items-center justify-between gap-4 rounded-lg border p-3"
    >
      <div class="min-w-0 space-y-1">
        <p class="text-foreground text-xs font-medium">Config files</p>
        <p class="text-muted-foreground text-xs">
          Tag-to-field rules and build thresholds. Rebuild to apply.
        </p>
      </div>
      <div class="flex shrink-0 flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          :disabled="!status"
          class="border-border bg-secondary hover:bg-accent h-8 gap-1.5 text-xs font-medium"
          @click="status && showInFolder(status.configDir)"
        >
          <FileCog class="h-3.5 w-3.5" />
          Config folder
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="border-border bg-secondary hover:bg-accent h-8 gap-1.5 text-xs font-medium"
          @click="resetConfig"
        >
          <RotateCcw class="h-3.5 w-3.5" />
          Reset to defaults
        </Button>
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-muted-foreground min-w-0 flex-1 text-xs">
        Download the latest data and build with your config.
      </p>
      <div class="flex shrink-0 gap-2">
        <Button
          v-if="rebuilding"
          type="button"
          variant="outline"
          size="sm"
          :disabled="store.stopping"
          class="border-border bg-secondary hover:bg-accent h-8 gap-1.5 text-xs font-medium"
          @click="stopRebuild"
        >
          <Square class="h-3.5 w-3.5 text-rose-400" />
          {{ store.stopping ? 'Stopping…' : 'Stop' }}
        </Button>
        <Button
          type="button"
          size="sm"
          :disabled="rebuilding || !status || missingPython"
          class="h-8 gap-1.5 text-xs font-medium"
          @click="rebuild"
        >
          <Loader2 v-if="rebuilding" class="h-3.5 w-3.5 animate-spin" />
          <Hammer v-else class="h-3.5 w-3.5" />
          <template v-if="rebuilding">Building…</template>
          <template v-else>{{
            installed ? 'Rebuild dataset' : 'Build dataset'
          }}</template>
        </Button>
      </div>
    </div>

    <NoticeBanner v-if="missingPython && !rebuilding">
      Set ComfyUI's Python folder in the ComfyUI tab first.
    </NoticeBanner>

    <div
      v-if="store.rebuilding"
      class="border-border/60 bg-muted/20 flex flex-col gap-2 rounded-lg border p-3"
      role="status"
      aria-live="polite"
    >
      <div class="flex items-baseline justify-between gap-3 text-xs">
        <p class="text-foreground min-w-0 truncate font-medium">
          <template v-if="progress">
            Step {{ progress.step }} of {{ progress.steps }} ·
            {{ progress.label }}
          </template>
          <template v-else>Starting Python…</template>
        </p>
        <span class="text-muted-foreground shrink-0 font-mono">{{
          elapsed
        }}</span>
      </div>
      <Progress
        :model-value="progress ? rebuildPercent(progress) : 0"
        class="h-1.5"
      />
      <p class="text-muted-foreground flex justify-between gap-3 text-xs">
        <span class="font-mono">{{
          progress ? progressDetail(progress) : ''
        }}</span>
        <span>{{ progress ? `${rebuildPercent(progress)}%` : '' }}</span>
      </p>
    </div>

    <NoticeBanner v-else-if="detachedRebuild" tone="info">
      A build started earlier is still running. Its progress is in the server
      terminal.
    </NoticeBanner>

    <NoticeBanner v-for="warning in store.rebuildWarnings" :key="warning">
      {{ warning }}
    </NoticeBanner>

    <template v-if="outcome && !store.rebuilding">
      <NoticeBanner
        :tone="
          outcome.ok ? 'emerald' : outcome.stopped ? 'amber' : 'destructive'
        "
      >
        {{ outcome.ok ? summaryText() : outcome.message }}
        <template v-if="!outcome.ok" #actions>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            :disabled="clearingDownloads"
            class="h-7 shrink-0 text-xs"
            @click="clearDownloads"
          >
            <Trash2 class="h-3.5 w-3.5" />
            Delete downloads
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="h-7 shrink-0 text-xs"
            @click="router.push('/server')"
          >
            <Terminal class="h-3.5 w-3.5" />
            Full log
          </Button>
        </template>
      </NoticeBanner>
      <NoticeBanner v-if="outcome.ok && outcome.summary?.cleanupError">
        {{ outcome.summary.cleanupError }}
      </NoticeBanner>
    </template>
  </SettingsSection>
</template>
