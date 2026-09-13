import { invoke } from '@tauri-apps/api/core';

type AppDataName =
  | 'ai_config'
  | 'booru_prompt_format_options'
  | 'booru_gallery_state'
  | 'chat_sessions'
  | 'civitai_browser_state'
  | 'civitai_settings'
  | 'face_detailer_preferences'
  | 'launcher_config'
  | 'lora_presets'
  | 'model_manager_state'
  | 'prompt_textarea_sizes'
  | 'prompt_format_options'
  | 'remove_background_preferences'
  | 'session_history'
  | 'upscaler_preferences'
  | 'ultimate_upscale_preferences'
  | 'workflow_session_state';

type DataFile = 'config' | 'history' | 'state' | 'chat' | 'ai_config';
const dataFiles: Record<AppDataName, DataFile> = {
  ai_config: 'ai_config',
  booru_prompt_format_options: 'state',
  booru_gallery_state: 'state',
  chat_sessions: 'chat',
  civitai_browser_state: 'state',
  civitai_settings: 'config',
  face_detailer_preferences: 'state',
  launcher_config: 'config',
  lora_presets: 'state',
  model_manager_state: 'state',
  prompt_textarea_sizes: 'state',
  prompt_format_options: 'state',
  remove_background_preferences: 'state',
  session_history: 'history',
  upscaler_preferences: 'state',
  ultimate_upscale_preferences: 'state',
  workflow_session_state: 'state'
};

const pendingWrites: Record<DataFile, Promise<void>> = {
  config: Promise.resolve(),
  history: Promise.resolve(),
  state: Promise.resolve(),
  chat: Promise.resolve(),
  ai_config: Promise.resolve()
};

export async function loadAppData<T>(name: AppDataName): Promise<T | null> {
  const file = dataFiles[name];
  await pendingWrites[file].catch(console.error);
  return await invoke<T | null>('get_app_data_entry', {
    name: file,
    key: name
  });
}

export async function saveAppData(
  name: AppDataName,
  value: unknown
): Promise<void> {
  const file = dataFiles[name];
  const write = pendingWrites[file].catch(console.error).then(async () => {
    await invoke('set_app_data_entry', {
      name: file,
      key: name,
      value
    });
  });
  pendingWrites[file] = write;
  await write;
}

export async function deleteAppData(name: AppDataName): Promise<void> {
  const file = dataFiles[name];
  const write = pendingWrites[file].catch(console.error).then(async () => {
    await invoke('remove_app_data_entry', {
      name: file,
      key: name
    });
  });
  pendingWrites[file] = write;
  await write;
}
