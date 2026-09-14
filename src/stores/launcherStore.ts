import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { defineStore } from 'pinia';
import { computed, onUnmounted, ref } from 'vue';
import { loadAppData, saveAppData } from '../services/appStorage';
import { ComfyApi } from '../services/comfyApi';
import type {
  LauncherConfig,
  LogEntry,
  ProcessStatus
} from '../types/launcher';

export const DEFAULT_LAUNCHER_CONFIG: LauncherConfig = {
  workingDir: '',
  pythonPath: '',
  args: '--windows-standalone-build --fast fp16_accumulation --cuda-malloc --use-sage-attention --preview-method latent2rgb --enable-manager --disable-auto-launch --enable-cors-header',
  serverUrl: 'http://127.0.0.1:8188',
  autoStart: false,
  autocompleteEnabled: true,
  autocompleteAlgorithm: 'fuzzy',
  autocompleteLimit: 20,
  autocompleteReplaceUnderscores: false,
  autocompleteIncludeArtistPrefix: true
};

export function cleanPath(value: string): string {
  return typeof value === 'string'
    ? value
        .trim()
        .replaceAll(/^['"]+|['"]+$/gu, '')
        .trim()
    : '';
}

export function parseLauncherArgs(value: string): string[] {
  if (typeof value !== 'string') return [];
  return Array.from(
    value.matchAll(/[^\s"']+|"([^"]*)"|'([^']*)'/gu),
    (match) => match[1] ?? match[2] ?? match[0]
  );
}

const STORAGE_KEY = 'launcher_config';

export const useLauncherStore = defineStore('launcher', () => {
  const config = ref<LauncherConfig>({ ...DEFAULT_LAUNCHER_CONFIG });
  const processStatus = ref<ProcessStatus>('stopped');
  const logs = ref<LogEntry[]>([]);
  const isTerminalOpen = ref(false);
  const isSettingsOpen = ref(false);
  const errorMessage = ref('');
  const hasComfyDirectory = computed(
    () => cleanPath(config.value.workingDir).length > 0
  );
  const localSetupMessage = computed(() => {
    if (!hasComfyDirectory.value)
      return 'Choose your ComfyUI folder in Settings to use local images, model discovery, and downloads.';
    if (!cleanPath(config.value.pythonPath))
      return 'Choose your Python executable in Settings to enable local model discovery and start ComfyUI.';
    return '';
  });

  let unlistenLog: UnlistenFn | null = null;
  let unlistenStatus: UnlistenFn | null = null;

  async function loadConfig() {
    try {
      const parsed = await loadAppData<Partial<LauncherConfig>>(STORAGE_KEY);
      if (parsed) {
        if (typeof parsed.args === 'string') {
          parsed.args = parsed.args
            .replace(/^-s\s+(?:ComfyUI[\\/])?main\.py\s*/u, '')
            .trim();
          if (!parsed.args.includes('--enable-cors-header')) {
            parsed.args = `${parsed.args} --enable-cors-header`.trim();
          }
        }
        config.value = { ...DEFAULT_LAUNCHER_CONFIG, ...parsed };
      }
    } catch {}
  }

  async function saveConfig(newConfig?: Partial<LauncherConfig>) {
    if (newConfig) {
      config.value = {
        ...config.value,
        ...newConfig,
        ...(newConfig.workingDir !== undefined && {
          workingDir: cleanPath(newConfig.workingDir)
        }),
        ...(newConfig.pythonPath !== undefined && {
          pythonPath: cleanPath(newConfig.pythonPath)
        }),
        ...(newConfig.serverUrl !== undefined && {
          serverUrl: cleanPath(newConfig.serverUrl)
        })
      };
    }
    await saveAppData(STORAGE_KEY, config.value);
  }

  async function selectComfyDir(): Promise<string | null> {
    try {
      const selected = await invoke<string | null>('pick_directory', {
        title: 'Select ComfyUI Folder (the folder containing main.py)',
        defaultPath: config.value.workingDir
      });
      return selected;
    } catch (e) {
      console.error('Failed to open directory dialog', e);
      return null;
    }
  }

  async function selectPythonDir(): Promise<string | null> {
    try {
      const selected = await invoke<string | null>('pick_directory', {
        title: 'Select Embedded Python Directory (e.g. python_embeded)',
        defaultPath: config.value.pythonPath
      });
      return selected;
    } catch (e) {
      console.error('Failed to open directory dialog', e);
      return null;
    }
  }

  async function selectPythonFile(): Promise<string | null> {
    try {
      const selected = await invoke<string | null>('pick_file', {
        title: 'Select Python Executable',
        defaultPath: config.value.pythonPath,
        filterName: 'Executable',
        filterExtensions: ['exe']
      });
      return selected;
    } catch (e) {
      console.error('Failed to open file dialog', e);
      return null;
    }
  }

  function addLog(
    stream: 'stdout' | 'stderr' | 'system',
    message: string,
    timestamp?: number
  ) {
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      stream,
      message,
      timestamp: timestamp || Date.now()
    };
    logs.value.push(entry);
    if (logs.value.length > 2000) {
      logs.value.shift();
    }
  }

  function clearLogs() {
    logs.value = [];
  }

  async function initTauriListeners() {
    await loadConfig();

    try {
      const isRunning = await invoke<boolean>('get_comfyui_status');
      processStatus.value = isRunning ? 'running' : 'stopped';
    } catch {
      // not running in Tauri or mock
    }

    try {
      if (!unlistenLog) {
        unlistenLog = await listen<{
          stream: 'stdout' | 'stderr';
          message: string;
          timestamp: number;
        }>('comfyui-log', (event) => {
          addLog(
            event.payload.stream,
            event.payload.message,
            event.payload.timestamp
          );
        });
      }

      if (!unlistenStatus) {
        unlistenStatus = await listen<{
          status: string;
          code: number | null;
        }>('comfyui-status', (event) => {
          if (event.payload.status === 'running') {
            processStatus.value = 'running';
            addLog('system', 'ComfyUI process started.');
          } else if (event.payload.status === 'stopped') {
            processStatus.value = 'stopped';
            addLog(
              'system',
              `ComfyUI process stopped. (Exit code: ${event.payload.code ?? 'N/A'})`
            );
          }
        });
      }
    } catch {
      // Running outside Tauri container
    }

    if (config.value.autoStart && processStatus.value === 'stopped') {
      await startServer();
    }
  }

  async function startServer() {
    if (localSetupMessage.value) {
      errorMessage.value = localSetupMessage.value;
      isSettingsOpen.value = true;
      return;
    }
    if (
      processStatus.value === 'running' ||
      processStatus.value === 'starting' ||
      processStatus.value === 'stopping'
    ) {
      return;
    }

    processStatus.value = 'starting';
    errorMessage.value = '';
    addLog('system', `Starting ComfyUI from ${config.value.workingDir}...`);

    try {
      const argsArray = parseLauncherArgs(config.value.args);

      await invoke('start_comfyui', {
        workingDir: config.value.workingDir,
        pythonPath: config.value.pythonPath,
        args: argsArray
      });
      processStatus.value = 'running';
    } catch (err) {
      processStatus.value = 'error';
      errorMessage.value = String(err);
      addLog('stderr', `Failed to start ComfyUI: ${err}`);
    }
  }

  async function stopServer() {
    if (processStatus.value === 'stopping') return;

    processStatus.value = 'stopping';
    errorMessage.value = '';
    try {
      addLog('system', 'Requesting graceful ComfyUI shutdown...');
      const gracefulRequested = await ComfyApi.shutdown(config.value.serverUrl);
      await invoke('stop_comfyui', { gracefulRequested });
      processStatus.value = 'stopped';
    } catch (err) {
      processStatus.value = 'running';
      addLog('stderr', `Failed to stop ComfyUI: ${err}`);
      throw err;
    }
  }

  async function restartServer() {
    await stopServer();
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve();
      }, 1000);
    });
    await startServer();
  }

  async function injectBridge(): Promise<string | null> {
    try {
      const result = await invoke<string>('inject_bridge_custom_node', {
        workingDir: config.value.workingDir
      });
      return result;
    } catch (err) {
      console.error('Failed to inject bridge custom node', err);
      return null;
    }
  }

  onUnmounted(() => {
    if (unlistenLog) unlistenLog();
    if (unlistenStatus) unlistenStatus();
  });

  return {
    config,
    processStatus,
    logs,
    isTerminalOpen,
    isSettingsOpen,
    errorMessage,
    hasComfyDirectory,
    localSetupMessage,
    loadConfig,
    saveConfig,
    selectComfyDir,
    selectPythonDir,
    selectPythonFile,
    addLog,
    clearLogs,
    initTauriListeners,
    startServer,
    stopServer,
    restartServer,
    injectBridge
  };
});
