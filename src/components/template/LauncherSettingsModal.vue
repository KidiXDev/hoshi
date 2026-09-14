<script setup lang="ts">
import { ref, watch } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import { FileCode, FolderOpen } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { useComfyStore } from '../../stores/comfyStore';
import {
  DEFAULT_LAUNCHER_CONFIG,
  useLauncherStore
} from '../../stores/launcherStore';

const launcherStore = useLauncherStore();
const comfyStore = useComfyStore();

const tempWorkingDir = ref(launcherStore.config.workingDir);
const tempPythonPath = ref(launcherStore.config.pythonPath);
const tempArgs = ref(launcherStore.config.args);
const tempServerUrl = ref(launcherStore.config.serverUrl);
let syncingSettings = false;

watch(
  () => launcherStore.isSettingsOpen,
  (open) => {
    if (open) {
      syncingSettings = true;
      tempWorkingDir.value = launcherStore.config.workingDir;
      tempPythonPath.value = launcherStore.config.pythonPath;
      tempArgs.value = launcherStore.config.args;
      tempServerUrl.value = launcherStore.config.serverUrl;
      syncingSettings = false;
    }
  }
);

async function handleBrowseComfyDir() {
  const dir = await launcherStore.selectComfyDir();
  if (dir) {
    tempWorkingDir.value = dir;
  }
}

async function handleBrowsePythonDir() {
  const dir = await launcherStore.selectPythonDir();
  if (dir) {
    tempPythonPath.value = dir;
  }
}

async function handleBrowsePythonFile() {
  const file = await launcherStore.selectPythonFile();
  if (file) {
    tempPythonPath.value = file;
  }
}

const autosave = useDebounceFn(async () => {
  const serverChanged = tempServerUrl.value !== launcherStore.config.serverUrl;
  await launcherStore.saveConfig({
    workingDir: tempWorkingDir.value,
    pythonPath: tempPythonPath.value,
    args: tempArgs.value.trim(),
    serverUrl: tempServerUrl.value
  });
  if (serverChanged) comfyStore.init();
}, 600);

watch(
  [tempWorkingDir, tempPythonPath, tempArgs, tempServerUrl],
  () => {
    if (launcherStore.isSettingsOpen && !syncingSettings) {
      void autosave().catch(console.error);
    }
  },
  { flush: 'sync' }
);

function handleResetDefaults() {
  tempWorkingDir.value = DEFAULT_LAUNCHER_CONFIG.workingDir;
  tempPythonPath.value = DEFAULT_LAUNCHER_CONFIG.pythonPath;
  tempArgs.value = DEFAULT_LAUNCHER_CONFIG.args;
  tempServerUrl.value = DEFAULT_LAUNCHER_CONFIG.serverUrl;
}
</script>

<template>
  <Dialog v-model:open="launcherStore.isSettingsOpen">
    <DialogContent class="w-full max-w-2xl">
      <DialogHeader class="flex-row items-center justify-between">
        <DialogTitle>Launcher Settings</DialogTitle>
        <DialogCloseButton class="-my-1.5 -mr-2" />
      </DialogHeader>

      <div class="flex flex-col gap-4 py-2">
        <Field class="gap-1.5">
          <FieldLabel class="text-foreground text-xs font-medium">
            ComfyUI Folder (Folder containing main.py)
          </FieldLabel>
          <div class="flex items-center gap-2">
            <Input
              v-model="tempWorkingDir"
              placeholder="Select the folder containing main.py"
              class="w-full font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="border-border bg-secondary text-foreground hover:bg-accent shrink-0 text-xs"
              @click="handleBrowseComfyDir"
            >
              <FolderOpen class="h-3.5 w-3.5" />
              <span>Browse Folder...</span>
            </Button>
          </div>
          <FieldDescription class="text-xs">
            The folder where <code>main.py</code> resides (or the portable root
            directory).
          </FieldDescription>
        </Field>

        <Field class="gap-1.5">
          <FieldLabel class="text-foreground text-xs font-medium">
            Embedded Python Folder or Executable
          </FieldLabel>
          <div class="flex items-center gap-2">
            <Input
              v-model="tempPythonPath"
              placeholder="e.g. python_embeded or python_embeded\python.exe"
              class="w-full font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="border-border bg-secondary text-foreground hover:bg-accent shrink-0 text-xs"
              @click="handleBrowsePythonDir"
            >
              <FolderOpen class="h-3.5 w-3.5" />
              <span>Folder</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="border-border bg-secondary text-foreground hover:bg-accent shrink-0 text-xs"
              @click="handleBrowsePythonFile"
            >
              <FileCode class="h-3.5 w-3.5" />
              <span>Executable</span>
            </Button>
          </div>
          <FieldDescription class="text-xs">
            Folder containing embedded Python (<code>python_embeded</code>) or
            direct path to <code>python.exe</code>.
          </FieldDescription>
        </Field>

        <Field class="gap-1.5">
          <FieldLabel class="text-foreground text-xs font-medium">
            Launch Command Arguments
          </FieldLabel>
          <Textarea
            v-model="tempArgs"
            rows="3"
            placeholder="--windows-standalone-build --fast fp16_accumulation --cuda-malloc --use-sage-attention --preview-method latent2rgb --enable-manager --disable-auto-launch"
            class="w-full font-mono text-xs leading-relaxed"
          />
          <FieldDescription class="text-xs">
            CLI flags passed to ComfyUI. The app automatically passes
            <code>-s &lt;main.py&gt;</code> to the Python runtime.
          </FieldDescription>
        </Field>

        <Field class="gap-1.5">
          <FieldLabel class="text-foreground text-xs font-medium">
            ComfyUI Server Endpoint URL
          </FieldLabel>
          <Input
            v-model="tempServerUrl"
            placeholder="http://127.0.0.1:8188"
            class="w-full font-mono text-xs"
          />
          <FieldDescription class="text-xs">
            HTTP endpoint and WebSocket URL for the server.
          </FieldDescription>
        </Field>
      </div>

      <DialogFooter
        class="flex w-full items-center justify-between sm:justify-between"
      >
        <Button
          variant="ghost"
          size="sm"
          class="text-muted-foreground hover:text-foreground text-xs"
          @click="handleResetDefaults"
        >
          Reset Defaults
        </Button>
        <span class="text-muted-foreground text-xs"
          >Changes save automatically</span
        >
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
