import { NativeModules, Platform } from 'react-native';

interface FloatingBallModule {
  canDrawOverlays: () => Promise<boolean>;
  openOverlaySettings: () => Promise<boolean>;
  show: () => Promise<boolean>;
  hide: () => Promise<boolean>;
  isShowing: () => Promise<boolean>;
  showMessage: (text: string) => Promise<boolean>;
  hideMessage: () => Promise<boolean>;
}

const nativeModule = NativeModules.FloatingBall as FloatingBallModule | undefined;

function ensureFloatingBall(): FloatingBallModule {
  if (Platform.OS !== 'android') {
    throw new Error('悬浮球仅支持 Android');
  }
  if (!nativeModule) {
    throw new Error('悬浮球原生模块未加载，请重新运行 npx expo run:android 安装新包');
  }
  return nativeModule;
}

export async function canDrawFloatingBall(): Promise<boolean> {
  return ensureFloatingBall().canDrawOverlays();
}

export async function openFloatingBallPermissionSettings(): Promise<void> {
  await ensureFloatingBall().openOverlaySettings();
}

export async function showFloatingBall(): Promise<void> {
  await ensureFloatingBall().show();
}

export async function hideFloatingBall(): Promise<void> {
  await ensureFloatingBall().hide();
}

export async function isFloatingBallShowing(): Promise<boolean> {
  return ensureFloatingBall().isShowing();
}

export async function showFloatingBallMessage(text: string): Promise<void> {
  await ensureFloatingBall().showMessage(text);
}

export async function hideFloatingBallMessage(): Promise<void> {
  await ensureFloatingBall().hideMessage();
}
