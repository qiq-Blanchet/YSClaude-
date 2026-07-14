import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { useSettingsPageColors } from '../../theme/colors';
import { useSettingsStore } from '../../stores/settings';
import {
  canDrawFloatingBall,
  hideFloatingBall,
  openFloatingBallPermissionSettings,
  showFloatingBall,
  syncFloatingBallAssets,
} from '../../services/floatingBall';
import { getTTSConfigMissingMessage, isTTSConfigReady } from '../../services/tts';
import { copyFileFromUri } from '../../utils/fileSystem';
import { ClampedNumberInput } from './ClampedNumberInput';
import { createSettingsStyles } from './styles';

type FloatingBallTabProps = {
  showToast: (message: string) => void;
  keyboardBottomInset: number;
};

const CUSTOM_FLOATING_BALL_MAX_BYTES = 8 * 1024 * 1024;
const CUSTOM_FLOATING_BALL_MIN_SIDE = 24;
const CUSTOM_FLOATING_BALL_MAX_SIDE = 2048;
const CUSTOM_FLOATING_BALL_SELECTION_LIMIT = 50;
const FLOATING_BALL_SIZE_DEFAULT = 64;
const FLOATING_BALL_SIZE_MIN = 32;
const FLOATING_BALL_SIZE_MAX = 160;

function floatingBallImageExtension(asset: ImagePicker.ImagePickerAsset): string {
  const mimeType = asset.mimeType?.toLowerCase();
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/gif') return '.gif';
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return '.jpg';

  const cleanUri = asset.uri.split('?')[0].toLowerCase();
  if (cleanUri.endsWith('.png')) return '.png';
  if (cleanUri.endsWith('.webp')) return '.webp';
  if (cleanUri.endsWith('.gif')) return '.gif';
  if (cleanUri.endsWith('.jpeg')) return '.jpg';
  if (cleanUri.endsWith('.jpg')) return '.jpg';
  return '.png';
}

function validateFloatingBallAsset(asset: ImagePicker.ImagePickerAsset): string | null {
  const mimeType = asset.mimeType?.toLowerCase();
  const extension = floatingBallImageExtension(asset);
  const isAllowedType =
    mimeType === 'image/png' ||
    mimeType === 'image/jpeg' ||
    mimeType === 'image/jpg' ||
    mimeType === 'image/gif' ||
    ['.png', '.jpg', '.gif'].includes(extension);

  if (!isAllowedType) {
    return '只支持 PNG、JPG 或 GIF';
  }
  if (asset.fileSize && asset.fileSize > CUSTOM_FLOATING_BALL_MAX_BYTES) {
    return '图片不能超过 8MB';
  }
  if (asset.width < CUSTOM_FLOATING_BALL_MIN_SIDE || asset.height < CUSTOM_FLOATING_BALL_MIN_SIDE) {
    return `图片边长至少 ${CUSTOM_FLOATING_BALL_MIN_SIDE}px`;
  }
  if (asset.width > CUSTOM_FLOATING_BALL_MAX_SIDE || asset.height > CUSTOM_FLOATING_BALL_MAX_SIDE) {
    return `图片边长不能超过 ${CUSTOM_FLOATING_BALL_MAX_SIDE}px`;
  }
  return null;
}

async function copyFloatingBallImage(asset: ImagePicker.ImagePickerAsset, prefix: string): Promise<string> {
  const dir = new Directory(Paths.document, 'floating-ball-assets');
  dir.create({ intermediates: true, idempotent: true });

  const destination = new File(dir, `${prefix}-${randomUUID()}${floatingBallImageExtension(asset)}`);
  await copyFileFromUri(asset.uri, destination);
  return destination.uri;
}

function mergeUniqueUris(existing: string[], next: string[], limit?: number): string[] {
  const merged = Array.from(new Set([...existing, ...next].map((uri) => uri.trim()).filter(Boolean)));
  return typeof limit === 'number' ? merged.slice(0, limit) : merged;
}

export function FloatingBallTab({ showToast, keyboardBottomInset }: FloatingBallTabProps) {
  const colors = useSettingsPageColors();
  const styles = useMemo(() => createSettingsStyles(colors), [colors]);
  const { floatingBallConfig, setFloatingBallConfig, ttsConfig } = useSettingsStore();
  const [busy, setBusy] = useState(false);
  const [pickingBallImage, setPickingBallImage] = useState<'normal' | 'edge' | null>(null);
  const normalImageUris = mergeUniqueUris(
    floatingBallConfig.normalImageUris || [],
    floatingBallConfig.normalImageUri ? [floatingBallConfig.normalImageUri] : []
  );
  const edgeImageUris = mergeUniqueUris(
    floatingBallConfig.edgeImageUris || [],
    floatingBallConfig.edgeImageUri ? [floatingBallConfig.edgeImageUri] : []
  );
  const assetAutoSwitchEnabled = !!floatingBallConfig.assetAutoSwitchEnabled;
  const assetAutoSwitchIntervalSeconds = floatingBallConfig.assetAutoSwitchIntervalSeconds || 8;
  const normalSizeDp = floatingBallConfig.normalSizeDp ?? FLOATING_BALL_SIZE_DEFAULT;
  const edgeSizeDp = floatingBallConfig.edgeSizeDp ?? FLOATING_BALL_SIZE_DEFAULT;

  async function handlePickFloatingBallImage(kind: 'normal' | 'edge') {
    if (pickingBallImage) return;
    const existingUris = kind === 'normal' ? normalImageUris : edgeImageUris;
    const remainingSlots = CUSTOM_FLOATING_BALL_SELECTION_LIMIT - existingUris.length;
    if (remainingSlots <= 0) {
      Alert.alert('悬浮球素材已满', `每种状态最多保存 ${CUSTOM_FLOATING_BALL_SELECTION_LIMIT} 个素材。`);
      return;
    }
    setPickingBallImage(kind);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: remainingSlots,
        allowsEditing: false,
        quality: 1,
      });
      if (result.canceled || result.assets.length === 0) return;

      const validationError = result.assets
        .map(validateFloatingBallAsset)
        .find((error): error is string => !!error);
      if (validationError) {
        Alert.alert('悬浮球素材不可用', validationError);
        return;
      }

      const copiedUris = await Promise.all(
        result.assets.map((asset) => copyFloatingBallImage(asset, kind === 'normal' ? 'normal' : 'edge'))
      );
      const nextUris = mergeUniqueUris(existingUris, copiedUris, CUSTOM_FLOATING_BALL_SELECTION_LIMIT);
      setFloatingBallConfig(
        kind === 'normal'
          ? { normalImageUris: nextUris, normalImageUri: nextUris[0] }
          : { edgeImageUris: nextUris, edgeImageUri: nextUris[0] }
      );
      if (floatingBallConfig.enabled) {
        syncFloatingBallAssets().catch(() => undefined);
      }
      showToast(kind === 'normal' ? '正常态素材已更新' : '贴边态素材已更新');
    } catch (error: any) {
      Alert.alert('选择悬浮球素材失败', error?.message || '无法读取所选图片');
    } finally {
      setPickingBallImage(null);
    }
  }

  function handleClearFloatingBallImage(kind: 'normal' | 'edge') {
    setFloatingBallConfig(
      kind === 'normal'
        ? { normalImageUris: [], normalImageUri: undefined }
        : { edgeImageUris: [], edgeImageUri: undefined }
    );
    if (floatingBallConfig.enabled) {
      syncFloatingBallAssets().catch(() => undefined);
    }
    showToast(kind === 'normal' ? '正常态已恢复默认球形' : '贴边态已恢复默认球形');
  }

  function handleSizeChange(kind: 'normal' | 'edge', value: number) {
    setFloatingBallConfig(kind === 'normal' ? { normalSizeDp: value } : { edgeSizeDp: value });
    if (floatingBallConfig.enabled) {
      syncFloatingBallAssets().catch(() => undefined);
    }
  }

  async function handleToggle(value: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      if (!value) {
        await hideFloatingBall();
        setFloatingBallConfig({ enabled: false });
        showToast('悬浮球已关闭');
        return;
      }

      const granted = await canDrawFloatingBall();
      if (!granted) {
        setFloatingBallConfig({ enabled: false });
        Alert.alert(
          '需要悬浮窗权限',
          '请在系统设置中允许 YSClaude 显示在其他应用上层，返回后再开启悬浮球。',
          [
            { text: '取消', style: 'cancel' },
            { text: '去设置', onPress: () => openFloatingBallPermissionSettings().catch(() => undefined) },
          ]
        );
        return;
      }

      await showFloatingBall();
      setFloatingBallConfig({ enabled: true });
      showToast('悬浮球已开启');
    } catch (error: any) {
      setFloatingBallConfig({ enabled: false });
      Alert.alert('悬浮球不可用', error?.message || '请重新安装包含原生模块的新包');
    } finally {
      setBusy(false);
    }
  }

  function handleTTSToggle(value: boolean) {
    if (value && !isTTSConfigReady(ttsConfig)) {
      setFloatingBallConfig({ ttsEnabled: false });
      Alert.alert('需要 TTS 配置', getTTSConfigMissingMessage(ttsConfig));
      return;
    }
    setFloatingBallConfig({ ttsEnabled: value });
    showToast(value ? '悬浮球 TTS 已开启' : '悬浮球 TTS 已关闭');
  }

  return (
    <ScrollView
      style={styles.content}
      contentContainerStyle={{ paddingBottom: keyboardBottomInset + 20 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.switchRow}>
        <Text style={styles.label}>开启悬浮球</Text>
        <Switch
          value={floatingBallConfig.enabled}
          onValueChange={handleToggle}
          disabled={busy}
          trackColor={{ false: colors.inputBorder, true: colors.primary }}
          thumbColor="#FFFFFF"
        />
      </View>

      <Text style={styles.sectionTitle}>悬浮球素材</Text>
      <Text style={styles.hint}>支持 PNG、JPG、GIF。正常态用于平时显示，贴边态用于吸附屏幕边缘；每种状态最多 {CUSTOM_FLOATING_BALL_SELECTION_LIMIT} 个素材。</Text>
      <Text style={styles.hint}>正常态 {normalImageUris.length} / {CUSTOM_FLOATING_BALL_SELECTION_LIMIT} 个，贴边态 {edgeImageUris.length} / {CUSTOM_FLOATING_BALL_SELECTION_LIMIT} 个</Text>
      {([
        { kind: 'normal' as const, label: '正常态', uri: floatingBallConfig.normalImageUri },
        { kind: 'edge' as const, label: '贴边态', uri: floatingBallConfig.edgeImageUri },
      ]).map((item) => {
        const isPicking = pickingBallImage === item.kind;
        return (
          <View key={item.kind} style={styles.appearanceAssetRow}>
            <View style={styles.floatingBallPreview}>
              {item.uri ? (
                <Image source={{ uri: item.uri }} style={styles.appearanceImageThumb} resizeMode="contain" />
              ) : (
                <View style={styles.defaultFloatingBallPreview} />
              )}
            </View>
            <View style={styles.appearanceIconText}>
              <Text style={styles.label}>{item.label}</Text>
              <Text style={styles.hint}>{item.uri ? '已使用自定义素材' : '使用默认球形'}</Text>
            </View>
            <View style={styles.appearanceIconActions}>
              <Pressable
                style={[styles.smallActionButton, isPicking && styles.smallActionButtonDisabled]}
                onPress={() => handlePickFloatingBallImage(item.kind)}
                disabled={!!pickingBallImage}
              >
                {isPicking ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.smallActionText}>替换</Text>}
              </Pressable>
              <Pressable
                style={[styles.smallActionButton, !item.uri && styles.smallActionButtonDisabled]}
                onPress={() => handleClearFloatingBallImage(item.kind)}
                disabled={!item.uri}
              >
                <Text style={[styles.smallActionText, !item.uri && styles.smallActionTextDisabled]}>默认</Text>
              </Pressable>
            </View>
          </View>
        );
      })}

      <Text style={styles.sectionTitle}>悬浮球大小</Text>
      <Text style={styles.hint}>单位为 dp，正常态和贴边态可分别调整，范围 {FLOATING_BALL_SIZE_MIN}-{FLOATING_BALL_SIZE_MAX}。</Text>
      <View style={styles.floatingBallSizeRow}>
        <View style={styles.floatingBallSizeField}>
          <Text style={styles.label}>正常态大小</Text>
          <ClampedNumberInput
            value={normalSizeDp}
            fallback={FLOATING_BALL_SIZE_DEFAULT}
            min={FLOATING_BALL_SIZE_MIN}
            max={FLOATING_BALL_SIZE_MAX}
            placeholder={String(FLOATING_BALL_SIZE_DEFAULT)}
            onCommit={(value) => handleSizeChange('normal', value)}
          />
        </View>
        <View style={styles.floatingBallSizeField}>
          <Text style={styles.label}>贴边态大小</Text>
          <ClampedNumberInput
            value={edgeSizeDp}
            fallback={FLOATING_BALL_SIZE_DEFAULT}
            min={FLOATING_BALL_SIZE_MIN}
            max={FLOATING_BALL_SIZE_MAX}
            placeholder={String(FLOATING_BALL_SIZE_DEFAULT)}
            onCommit={(value) => handleSizeChange('edge', value)}
          />
        </View>
      </View>

      <View style={styles.switchRow}>
        <View style={styles.nativeToolText}>
          <Text style={styles.label}>素材自动切换</Text>
          <Text style={styles.hint}>开启后按当前状态，从正常态或贴边态素材池随机切换。</Text>
        </View>
        <Switch
          value={assetAutoSwitchEnabled}
          onValueChange={(value) => {
            setFloatingBallConfig({ assetAutoSwitchEnabled: value });
            showToast(value ? '素材自动切换已开启' : '素材自动切换已关闭');
          }}
          trackColor={{ false: colors.inputBorder, true: colors.primary }}
          thumbColor="#FFFFFF"
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>切换间隔（秒）</Text>
        <ClampedNumberInput
          value={assetAutoSwitchIntervalSeconds}
          fallback={8}
          min={1}
          max={3600}
          placeholder="8"
          onCommit={(value) => setFloatingBallConfig({ assetAutoSwitchIntervalSeconds: value })}
        />
      </View>

      <View style={styles.switchRow}>
        <View style={styles.nativeToolText}>
          <Text style={styles.label}>悬浮球 TTS</Text>
          <Text style={styles.hint}>使用当前 TTS 服务商配置朗读悬浮球气泡文字</Text>
        </View>
        <Switch
          value={!!floatingBallConfig.ttsEnabled}
          onValueChange={handleTTSToggle}
          trackColor={{ false: colors.inputBorder, true: colors.primary }}
          thumbColor="#FFFFFF"
        />
      </View>

      <View style={styles.switchRow}>
        <View style={styles.nativeToolText}>
          <Text style={styles.label}>截图后自动获取回复</Text>
          <Text style={styles.hint}>仅影响点按截图共享；长按截图+节点树模式仍等待手动获取回复</Text>
        </View>
        <Switch
          value={!!floatingBallConfig.autoReplyOnScreenshotShare}
          onValueChange={(value) => {
            setFloatingBallConfig({ autoReplyOnScreenshotShare: value });
            showToast(value ? '截图自动回复已开启' : '截图自动回复已关闭');
          }}
          trackColor={{ false: colors.inputBorder, true: colors.primary }}
          thumbColor="#FFFFFF"
        />
      </View>
    </ScrollView>
  );
}
