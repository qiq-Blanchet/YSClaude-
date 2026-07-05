import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import { useChatStore } from '../stores/chat';
import { useSettingsStore, type PromptCacheConfig } from '../stores/settings';
import { pushRemotePushConfig } from './promptCacheKeepalive';

type UnifiedPushEndpoint = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

type UnifiedPushNativeModule = {
  register: () => Promise<boolean>;
  unregister: () => Promise<boolean>;
  getEndpoint: () => Promise<UnifiedPushEndpoint | null>;
};

const MODULE_NAME = 'UnifiedPushConnector';
let listenerStarted = false;

function nativeModule(): UnifiedPushNativeModule | null {
  if (Platform.OS !== 'android') return null;
  return (NativeModules as any)[MODULE_NAME] || null;
}

function normalizeEndpoint(value: any): UnifiedPushEndpoint | null {
  const endpoint = typeof value?.endpoint === 'string' ? value.endpoint.trim() : '';
  const p256dh = typeof value?.p256dh === 'string' ? value.p256dh.trim() : '';
  const auth = typeof value?.auth === 'string' ? value.auth.trim() : '';
  if (!endpoint || !p256dh || !auth) return null;
  return { endpoint, p256dh, auth };
}

async function persistAndPushEndpoint(endpoint: UnifiedPushEndpoint): Promise<void> {
  const settings = useSettingsStore.getState();
  const nextConfig: Partial<PromptCacheConfig> = {
    upEndpoint: endpoint.endpoint,
    upP256dh: endpoint.p256dh,
    upAuth: endpoint.auth,
  };
  settings.setPromptCacheConfig(nextConfig);
  await pushRemotePushConfig({
    ...settings.promptCacheConfig,
    ...nextConfig,
  });
}

export async function getUnifiedPushEndpoint(): Promise<UnifiedPushEndpoint | null> {
  const module = nativeModule();
  if (!module) return null;
  const endpoint = normalizeEndpoint(await module.getEndpoint());
  if (endpoint) {
    await persistAndPushEndpoint(endpoint).catch(() => undefined);
  }
  return endpoint;
}

export async function registerUnifiedPush(): Promise<UnifiedPushEndpoint | null> {
  const module = nativeModule();
  if (!module) {
    throw new Error('UnifiedPush 仅支持 Android');
  }
  await module.register();
  return getUnifiedPushEndpoint();
}

export async function unregisterUnifiedPush(): Promise<boolean> {
  const module = nativeModule();
  if (!module) return false;
  await module.unregister();
  useSettingsStore.getState().setPromptCacheConfig({
    upEndpoint: '',
    upP256dh: '',
    upAuth: '',
  });
  return true;
}

export function startUnifiedPushListener(): () => void {
  if (listenerStarted) return () => undefined;
  listenerStarted = true;

  getUnifiedPushEndpoint().catch(() => undefined);

  const endpointSub = DeviceEventEmitter.addListener('YSClaudeUnifiedPushEndpoint', (payload) => {
    const endpoint = normalizeEndpoint(payload);
    if (endpoint) {
      persistAndPushEndpoint(endpoint).catch(() => undefined);
      return;
    }
    if (payload?.status === 'unregistered') {
      useSettingsStore.getState().setPromptCacheConfig({
        upEndpoint: '',
        upP256dh: '',
        upAuth: '',
      });
    }
  });

  const messageSub = DeviceEventEmitter.addListener('YSClaudeUnifiedPushMessage', () => {
    useChatStore.getState().syncPromptCacheRemoteInbox().catch(() => undefined);
  });

  return () => {
    endpointSub.remove();
    messageSub.remove();
    listenerStarted = false;
  };
}
