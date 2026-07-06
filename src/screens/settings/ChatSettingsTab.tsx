import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { copyAsync } from 'expo-file-system/legacy';
import { useThemeColors } from '../../theme/colors';
import {
  type ImageGenerationFaceReference,
  type PromptCacheConfig,
  type PromptCacheTtl,
  type StablePromptRole,
  useSettingsStore,
} from '../../stores/settings';
import { useChatStore } from '../../stores/chat';
import { type HiddenRange } from '../../types';
import { getChatDiagnosticsConversation, type ChatDiagnosticsMessage } from '../../db/operations';
import { formatFullTime } from '../../utils/time';
import { importMyphonePrivateChatsFromPicker } from '../../services/myphoneImport';
import {
  checkPromptCacheRemoteServer,
  disablePromptCacheRemoteKeepalive,
  enablePromptCacheRemoteKeepalive,
  flushPromptCacheRemoteSnapshotNow,
  getPromptCacheRemoteSnapshotStatus,
  refreshPromptCacheRemoteServerStatus,
  subscribePromptCacheRemoteSnapshotStatus,
  pushRemotePushConfig,
  testRemoteDingTalkPush,
  testRemoteWxPusherPush,
} from '../../services/promptCacheKeepalive';
import { mergeRanges } from '../../utils/ranges';
import { createSettingsStyles } from './styles';

type SettingsTabProps = {
  showToast: (message: string) => void;
  keyboardBottomInset: number;
};

const IMAGE_GENERATION_FACE_REFERENCE_MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_GENERATION_FACE_REFERENCE_MIN_SIDE = 64;
const IMAGE_GENERATION_FACE_REFERENCE_MAX_SIDE = 4096;
const IMAGE_GENERATION_FACE_REFERENCE_SELECTION_LIMIT = 16;
const PROMPT_CACHE_TTL_OPTIONS: Array<{ value: PromptCacheTtl; label: string }> = [
  { value: '5m', label: '5min' },
  { value: '1h', label: '1h' },
];
const PROMPT_CACHE_PUSH_CHANNEL_OPTIONS: Array<{ value: PromptCacheConfig['pushChannel']; label: string }> = [
  { value: 'dingtalk', label: '钉钉' },
  { value: 'wxpusher', label: 'WxPusher' },
];
const STABLE_PROMPT_ROLE_OPTIONS: Array<{ value: StablePromptRole; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'user', label: 'User' },
  { value: 'assistant', label: 'Assistant' },
];

function formatClockMinutes(minutes: number): string {
  const normalized = Math.min(1439, Math.max(0, Math.round(minutes)));
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseClockMinutes(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2})[:：](\d{1,2})$/);
  if (!match) return null;
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  return hour * 60 + minute;
}

function topBarIconExtension(asset: ImagePicker.ImagePickerAsset): string {
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

async function copyAppearanceImage(
  asset: ImagePicker.ImagePickerAsset,
  directoryName: string,
  prefix: string
): Promise<string> {
  const dir = new Directory(Paths.document, directoryName);
  dir.create({ intermediates: true, idempotent: true });

  const destination = new File(dir, `${prefix}-${randomUUID()}${topBarIconExtension(asset)}`);
  await copyAsync({ from: asset.uri, to: destination.uri });
  return destination.uri;
}

function validateImageGenerationFaceReferenceAsset(asset: ImagePicker.ImagePickerAsset): string | null {
  const mimeType = asset.mimeType?.toLowerCase();
  const extension = topBarIconExtension(asset);
  const isAllowedType =
    mimeType === 'image/png' ||
    mimeType === 'image/webp' ||
    mimeType === 'image/jpeg' ||
    mimeType === 'image/jpg' ||
    ['.png', '.webp', '.jpg'].includes(extension);

  if (!isAllowedType) {
    return '只支持 PNG、WebP 或 JPG';
  }
  if (asset.fileSize && asset.fileSize > IMAGE_GENERATION_FACE_REFERENCE_MAX_BYTES) {
    return '图片不能超过 8MB';
  }
  if (
    asset.width < IMAGE_GENERATION_FACE_REFERENCE_MIN_SIDE ||
    asset.height < IMAGE_GENERATION_FACE_REFERENCE_MIN_SIDE
  ) {
    return `图片边长至少 ${IMAGE_GENERATION_FACE_REFERENCE_MIN_SIDE}px`;
  }
  if (
    asset.width > IMAGE_GENERATION_FACE_REFERENCE_MAX_SIDE ||
    asset.height > IMAGE_GENERATION_FACE_REFERENCE_MAX_SIDE
  ) {
    return `图片边长不能超过 ${IMAGE_GENERATION_FACE_REFERENCE_MAX_SIDE}px`;
  }
  return null;
}

async function copyImageGenerationFaceReference(asset: ImagePicker.ImagePickerAsset): Promise<string> {
  return copyAppearanceImage(asset, 'image-generation-face-references', 'face-ref');
}

function deleteLocalImageIfExists(uri?: string) {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) {
      file.delete();
    }
  } catch {
    // Ignore cleanup failures; the settings entry is still removed.
  }
}

export function ChatSettingsTab({ showToast, keyboardBottomInset }: SettingsTabProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createSettingsStyles(colors), [colors]);
  const {
    maxOutputTokens,
    tokenWarningThreshold,
    systemPrompt,
    stablePromptRole,
    stripThinking,
    periodConfig,
    promptCacheConfig,
    imageGenerationConfig,
    imageGenerationPrompt,
    setSystemPrompt,
    setStablePromptRole,
    setMaxOutputTokens,
    setTokenWarningThreshold,
    setStripThinking,
    setPeriodConfig,
    setPromptCacheConfig,
    setImageGenerationConfig,
    setImageGenerationPrompt,
  } = useSettingsStore();
  // 隐藏楼层现在按对话独立存储，数据源改为 chat store
  const {
    messages,
    conversationId,
    hiddenRanges,
    hiddenMessageIds,
    messageFloorOffset,
    addHiddenRange,
    restoreHiddenRange,
    setMessageHidden,
    loadConversation,
  } = useChatStore();
  const [fromStr, setFromStr] = useState('');
  const [toStr, setToStr] = useState('');
  const [tokensStr, setTokensStr] = useState(maxOutputTokens ? String(maxOutputTokens) : '');
  const [tokenWarningStr, setTokenWarningStr] = useState(
    tokenWarningThreshold ? String(tokenWarningThreshold) : ''
  );
  const [promptText, setPromptText] = useState(systemPrompt);
  const [imagePromptText, setImagePromptText] = useState(imageGenerationPrompt || '');
  const [importingMyphone, setImportingMyphone] = useState(false);
  const [pickingFaceReferences, setPickingFaceReferences] = useState(false);
  const promptCacheTtl: PromptCacheTtl = promptCacheConfig?.ttl === '1h' ? '1h' : '5m';
  const [quietStartText, setQuietStartText] = useState(formatClockMinutes(promptCacheConfig?.quietStartMinutes ?? 23 * 60));
  const [quietEndText, setQuietEndText] = useState(formatClockMinutes(promptCacheConfig?.quietEndMinutes ?? 7 * 60));
  const [remoteServerUrlText, setRemoteServerUrlText] = useState(promptCacheConfig?.remoteServerUrl || '');
  const [remoteAuthTokenText, setRemoteAuthTokenText] = useState(promptCacheConfig?.remoteAuthToken || '');
  const [dingTalkWebhookText, setDingTalkWebhookText] = useState(promptCacheConfig?.dingTalkWebhook || '');
  const [dingTalkSecretText, setDingTalkSecretText] = useState(promptCacheConfig?.dingTalkSecret || '');
  const [dingTalkAtMobilesText, setDingTalkAtMobilesText] = useState(promptCacheConfig?.dingTalkAtMobiles || '');
  const [testingDingTalkPush, setTestingDingTalkPush] = useState(false);
  const [wxPusherAppTokenText, setWxPusherAppTokenText] = useState(promptCacheConfig?.wxPusherAppToken || '');
  const [wxPusherUidText, setWxPusherUidText] = useState(promptCacheConfig?.wxPusherUid || '');
  const [wxPusherTopicIdsText, setWxPusherTopicIdsText] = useState(promptCacheConfig?.wxPusherTopicIds || '');
  const [testingWxPusherPush, setTestingWxPusherPush] = useState(false);
  const [checkingRemoteKeepalive, setCheckingRemoteKeepalive] = useState(false);
  const [switchingRemoteKeepalive, setSwitchingRemoteKeepalive] = useState(false);
  const [flushingRemoteSnapshot, setFlushingRemoteSnapshot] = useState(false);
  const [refreshingRemoteServerStatus, setRefreshingRemoteServerStatus] = useState(false);
  const [remoteSnapshotStatus, setRemoteSnapshotStatus] = useState(() => getPromptCacheRemoteSnapshotStatus());
  const [hiddenDiagnosticMessages, setHiddenDiagnosticMessages] = useState<ChatDiagnosticsMessage[]>([]);

  useEffect(() => {
    setImagePromptText(imageGenerationPrompt || '');
  }, [imageGenerationPrompt]);

  useEffect(() => {
    setQuietStartText(formatClockMinutes(promptCacheConfig?.quietStartMinutes ?? 23 * 60));
    setQuietEndText(formatClockMinutes(promptCacheConfig?.quietEndMinutes ?? 7 * 60));
  }, [promptCacheConfig?.quietEndMinutes, promptCacheConfig?.quietStartMinutes]);

  useEffect(() => {
    setRemoteServerUrlText(promptCacheConfig?.remoteServerUrl || '');
    setRemoteAuthTokenText(promptCacheConfig?.remoteAuthToken || '');
    setDingTalkWebhookText(promptCacheConfig?.dingTalkWebhook || '');
    setDingTalkSecretText(promptCacheConfig?.dingTalkSecret || '');
    setDingTalkAtMobilesText(promptCacheConfig?.dingTalkAtMobiles || '');
    setWxPusherAppTokenText(promptCacheConfig?.wxPusherAppToken || '');
    setWxPusherUidText(promptCacheConfig?.wxPusherUid || '');
    setWxPusherTopicIdsText(promptCacheConfig?.wxPusherTopicIds || '');
  }, [
    promptCacheConfig?.remoteAuthToken,
    promptCacheConfig?.remoteServerUrl,
    promptCacheConfig?.dingTalkWebhook,
    promptCacheConfig?.dingTalkSecret,
    promptCacheConfig?.dingTalkAtMobiles,
    promptCacheConfig?.wxPusherAppToken,
    promptCacheConfig?.wxPusherUid,
    promptCacheConfig?.wxPusherTopicIds,
  ]);

  useEffect(() => {
    return subscribePromptCacheRemoteSnapshotStatus(() => {
      setRemoteSnapshotStatus(getPromptCacheRemoteSnapshotStatus());
    });
  }, []);

  useEffect(() => {
    refreshPromptCacheRemoteServerStatus(conversationId).catch(() => undefined);
  }, [conversationId, promptCacheConfig?.remoteAuthToken, promptCacheConfig?.remoteServerUrl]);

  useEffect(() => {
    let cancelled = false;
    if (!conversationId || hiddenMessageIds.length === 0) {
      setHiddenDiagnosticMessages([]);
      return () => {
        cancelled = true;
      };
    }

    getChatDiagnosticsConversation(conversationId)
      .then((detail) => {
        if (cancelled) return;
        const hiddenIdSet = new Set(hiddenMessageIds);
        setHiddenDiagnosticMessages(
          detail?.messages.filter((message) => hiddenIdSet.has(message.id)) ?? []
        );
      })
      .catch(() => {
        if (!cancelled) setHiddenDiagnosticMessages([]);
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, hiddenMessageIds]);

  // 仅取 user/assistant 消息作为「楼层」序列（1-based）
  const floorMessages = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  const hiddenDiagnosticById = new Map(hiddenDiagnosticMessages.map((message) => [message.id, message]));
  type HiddenMessageRow = {
    id: string;
    role: string | null;
    content: string | null;
    floor: number | null;
  };
  const hiddenMessageRows: HiddenMessageRow[] = hiddenMessageIds.map((id) => {
    const message = messages.find((item) => item.id === id) ?? null;
    const diagnosticMessage = hiddenDiagnosticById.get(id) ?? null;
    const localFloorIndex = message
      ? floorMessages.findIndex((item) => item.id === id)
      : -1;
    return {
      id,
      role: message?.role ?? diagnosticMessage?.role ?? null,
      content: message?.content ?? diagnosticMessage?.content ?? null,
      floor: localFloorIndex >= 0
        ? messageFloorOffset + localFloorIndex + 1
        : diagnosticMessage?.floorNumber ?? null,
    };
  });
  const hiddenMessageFloorRanges = hiddenMessageRows
    .filter((row): row is HiddenMessageRow & { floor: number } => row.floor !== null)
    .map((row) => ({ from: row.floor, to: row.floor }));
  const mergedHiddenRanges = mergeRanges([...hiddenRanges, ...hiddenMessageFloorRanges]);
  const hiddenContextRows = hiddenMessageRows.filter((row) => row.floor === null);
  const hasHiddenMessages = mergedHiddenRanges.length > 0 || hiddenContextRows.length > 0;
  const faceReferences = imageGenerationConfig?.faceReferences || [];
  const enabledFaceReferenceCount = faceReferences.filter((item) => item.enabled !== false).length;

  function handleAddRange() {
    const range = parseInputRange();
    if (!range) return;
    addHiddenRange(range);
    clearRangeInputs();
  }

  function handleRestoreRange() {
    const range = parseInputRange();
    if (!range) return;
    restoreHiddenRange(range);
    clearRangeInputs();
  }

  function parseInputRange() {
    const from = parseInt(fromStr, 10);
    const to = parseInt(toStr, 10);
    if (isNaN(from) || isNaN(to) || from < 1 || to < from) {
      Alert.alert('提示', '请输入有效的范围（起始 ≤ 结束，且 ≥ 1）');
      return null;
    }
    return { from, to };
  }

  function clearRangeInputs() {
    setFromStr('');
    setToStr('');
  }

  async function handleRestoreMergedRange(range: HiddenRange) {
    await restoreHiddenRange(range);
    const idsToRestore = hiddenMessageRows
      .filter((row) => row.floor !== null && row.floor >= range.from && row.floor <= range.to)
      .map((row) => row.id);
    await Promise.all(idsToRestore.map((id) => setMessageHidden(id, false)));
  }

  function formatHiddenRange(range: HiddenRange) {
    return range.from === range.to
      ? `第 ${range.from} 条`
      : `第 ${range.from} 条 ~ 第 ${range.to} 条`;
  }

  // 预览：两个输入都为有效数字时，给出该范围首尾两条消息的摘要
  const preview = (() => {
    const from = parseInt(fromStr, 10);
    const to = parseInt(toStr, 10);
    if (isNaN(from) || isNaN(to) || from < 1 || to < from) return null;
    const firstMsg = floorMessages[from - messageFloorOffset - 1] ?? null;
    const lastMsg = floorMessages[to - messageFloorOffset - 1] ?? null;
    if (!firstMsg && !lastMsg) return null;
    return {
      from,
      to,
      first: firstMsg,
      last: from === to ? null : lastMsg,
    };
  })();

  function roleLabel(role: string) {
    if (role === 'user') return '你';
    if (role === 'assistant') return 'AI';
    if (role === 'system') return '系统';
    return '工具';
  }

  function formatRemoteSnapshotState() {
    if (remoteSnapshotStatus.state === 'syncing') return '同步中';
    if (remoteSnapshotStatus.state === 'pending') return '待同步';
    if (remoteSnapshotStatus.state === 'failed') return '同步失败';
    if (remoteSnapshotStatus.state === 'synced' && remoteSnapshotStatus.source === 'server') return '服务端快照';
    if (remoteSnapshotStatus.state === 'synced') return '已同步';
    return '暂无快照';
  }

  function formatRemoteSnapshotTime() {
    if (remoteSnapshotStatus.nextSyncAt) {
      return `预计同步 ${formatFullTime(remoteSnapshotStatus.nextSyncAt)}`;
    }
    if (remoteSnapshotStatus.syncedAt) {
      return `最近同步 ${formatFullTime(remoteSnapshotStatus.syncedAt)}`;
    }
    if (remoteSnapshotStatus.lastSyncAttemptAt) {
      return `最近尝试 ${formatFullTime(remoteSnapshotStatus.lastSyncAttemptAt)}`;
    }
    if (remoteSnapshotStatus.queuedAt) {
      return `入队时间 ${formatFullTime(remoteSnapshotStatus.queuedAt)}`;
    }
    if (remoteSnapshotStatus.serverUpdatedAt) {
      return `服务端更新 ${formatFullTime(remoteSnapshotStatus.serverUpdatedAt)}`;
    }
    if (remoteSnapshotStatus.serverStatusFetchedAt) {
      return `服务端状态 ${formatFullTime(remoteSnapshotStatus.serverStatusFetchedAt)}`;
    }
    return '等待 1h cache 命中后的成功请求';
  }

  function formatRemoteServerStatus() {
    if (!remoteSnapshotStatus.serverStatus) return null;
    if (remoteSnapshotStatus.serverStatus === 'active') return '服务器保活中';
    if (remoteSnapshotStatus.serverStatus === 'disabled') {
      return remoteSnapshotStatus.serverDisabledReason
        ? `服务器已停用：${remoteSnapshotStatus.serverDisabledReason}`
        : '服务器已停用';
    }
    return `服务器状态：${remoteSnapshotStatus.serverStatus}`;
  }

  function formatRemoteSnapshotSourceMeta() {
    const source = remoteSnapshotStatus.source === 'server' ? '服务端' : '本地';
    if (remoteSnapshotStatus.state === 'syncing') return `${source} · 正在上传`;
    if (remoteSnapshotStatus.queueCount > 0) return `${source} · 队列 ${remoteSnapshotStatus.queueCount}/5`;
    return `${source} · 无待同步队列`;
  }

  function formatSnapshotHash(hash: string | null) {
    return hash ? hash.slice(0, 10) : null;
  }

  async function handleRefreshRemoteServerStatus() {
    if (refreshingRemoteServerStatus) return;
    setPromptCacheConfig({
      remoteServerUrl: remoteServerUrlText.trim(),
      remoteAuthToken: remoteAuthTokenText.trim(),
    });
    setRefreshingRemoteServerStatus(true);
    try {
      const ok = await refreshPromptCacheRemoteServerStatus(conversationId);
      showToast(ok ? '已刷新服务器快照状态' : '服务器状态读取失败');
    } catch (error: any) {
      showToast(error?.message || '服务器状态读取失败');
    } finally {
      setRemoteSnapshotStatus(getPromptCacheRemoteSnapshotStatus());
      setRefreshingRemoteServerStatus(false);
    }
  }

  async function handleFlushRemoteSnapshotNow() {
    if (flushingRemoteSnapshot || remoteSnapshotStatus.queueCount <= 0) return;
    setFlushingRemoteSnapshot(true);
    try {
      const ok = await flushPromptCacheRemoteSnapshotNow();
      showToast(ok ? '快照已同步到远程服务' : '快照同步失败');
    } catch (error: any) {
      showToast(error?.message || '快照同步失败');
    } finally {
      setRemoteSnapshotStatus(getPromptCacheRemoteSnapshotStatus());
      setFlushingRemoteSnapshot(false);
    }
  }

  function snippet(text: string) {
    const t = text.replace(/\s+/g, ' ').trim();
    return t.length > 60 ? t.slice(0, 60) + '…' : t;
  }

  function handleSaveTokens() {
    const val = tokensStr.trim();
    if (!val) {
      setMaxOutputTokens(null);
      showToast('输出字数不限制');
      return;
    }
    const num = parseInt(val, 10);
    if (isNaN(num) || num <= 0) {
      Alert.alert('提示', '请输入有效的正整数');
      return;
    }
    setMaxOutputTokens(num);
    showToast(`AI 最大输出 ${num} tokens`);
  }

  function handleSaveTokenWarning() {
    const val = tokenWarningStr.trim();
    if (!val) {
      setTokenWarningThreshold(null);
      showToast('Token 预警已关闭');
      return;
    }
    const num = parseInt(val, 10);
    if (isNaN(num) || num <= 0) {
      Alert.alert('提示', '请输入有效的正整数');
      return;
    }
    setTokenWarningThreshold(num);
    showToast(`Token 预警 ${num}`);
  }

  function handleSavePromptCacheQuietHours() {
    const startMinutes = parseClockMinutes(quietStartText);
    const endMinutes = parseClockMinutes(quietEndText);
    if (startMinutes === null || endMinutes === null) {
      Alert.alert('提示', '请输入 HH:mm 格式的时间，例如 23:00');
      setQuietStartText(formatClockMinutes(promptCacheConfig?.quietStartMinutes ?? 23 * 60));
      setQuietEndText(formatClockMinutes(promptCacheConfig?.quietEndMinutes ?? 7 * 60));
      return;
    }
    if (startMinutes === endMinutes) {
      Alert.alert('提示', '开始和结束时间不能相同');
      return;
    }
    setPromptCacheConfig({
      quietStartMinutes: startMinutes,
      quietEndMinutes: endMinutes,
    });
    setQuietStartText(formatClockMinutes(startMinutes));
    setQuietEndText(formatClockMinutes(endMinutes));
    showToast('远程保活勿扰时段已保存');
  }

  function handleSaveRemoteKeepaliveConfig() {
    setPromptCacheConfig({
      remoteServerUrl: remoteServerUrlText.trim(),
      remoteAuthToken: remoteAuthTokenText.trim(),
      pushChannel: promptCacheConfig?.pushChannel || 'dingtalk',
      dingTalkWebhook: dingTalkWebhookText.trim(),
      dingTalkSecret: dingTalkSecretText.trim(),
      dingTalkAtMobiles: dingTalkAtMobilesText.trim(),
      wxPusherAppToken: wxPusherAppTokenText.trim(),
      wxPusherUid: wxPusherUidText.trim(),
      wxPusherTopicIds: wxPusherTopicIdsText.trim(),
      keepaliveMode: 'remote',
    });
    showToast('远程保活配置已保存');
  }

  async function handleToggleRemoteKeepalive(value: boolean) {
    if (switchingRemoteKeepalive) return;
    const serverUrl = remoteServerUrlText.trim();
    const authToken = remoteAuthTokenText.trim();
    if (value && !serverUrl) {
      Alert.alert('提示', '请先填写远程保活服务地址');
      return;
    }

    setPromptCacheConfig({
      keepaliveMode: 'remote',
      remoteKeepaliveEnabled: value,
      remoteServerUrl: serverUrl,
      remoteAuthToken: authToken,
    });
    setSwitchingRemoteKeepalive(true);
    try {
      if (value) {
        const result = await enablePromptCacheRemoteKeepalive(conversationId);
        await refreshPromptCacheRemoteServerStatus(conversationId);
        showToast(result.ok ? '远程保活已开启并同步服务端' : (result.error || '远程保活已开启，等待下次快照同步'));
      } else {
        const ok = conversationId ? await disablePromptCacheRemoteKeepalive(conversationId) : true;
        await refreshPromptCacheRemoteServerStatus(conversationId);
        showToast(ok ? '远程保活已关闭并同步服务端' : '远程保活已关闭，服务端同步失败');
      }
    } catch (error: any) {
      showToast(error?.message || '远程保活开关同步失败');
    } finally {
      setRemoteSnapshotStatus(getPromptCacheRemoteSnapshotStatus());
      setSwitchingRemoteKeepalive(false);
    }
  }

  function currentPushConfig(): PromptCacheConfig {
    return {
      ...promptCacheConfig,
      dingTalkWebhook: dingTalkWebhookText.trim(),
      dingTalkSecret: dingTalkSecretText.trim(),
      dingTalkAtMobiles: dingTalkAtMobilesText.trim(),
      wxPusherAppToken: wxPusherAppTokenText.trim(),
      wxPusherUid: wxPusherUidText.trim(),
      wxPusherTopicIds: wxPusherTopicIdsText.trim(),
    };
  }

  function handleSaveDingTalkConfig() {
    const webhook = dingTalkWebhookText.trim();
    const secret = dingTalkSecretText.trim();
    const atMobiles = dingTalkAtMobilesText.trim();
    setPromptCacheConfig({
      pushChannel: webhook ? 'dingtalk' : promptCacheConfig?.pushChannel,
      dingTalkWebhook: webhook,
      dingTalkSecret: secret,
      dingTalkAtMobiles: atMobiles,
    });
    if (webhook) {
      pushRemotePushConfig({
        ...currentPushConfig(),
        pushChannel: 'dingtalk',
      }).catch(() => undefined);
    }
    showToast(webhook ? '钉钉推送配置已保存' : '钉钉推送已关闭');
  }

  async function handleTestDingTalkPush() {
    if (testingDingTalkPush) return;
    const webhook = dingTalkWebhookText.trim();
    if (!webhook) {
      showToast('请先填写钉钉机器人 Webhook');
      return;
    }
    setPromptCacheConfig({
      pushChannel: 'dingtalk',
      dingTalkWebhook: webhook,
      dingTalkSecret: dingTalkSecretText.trim(),
      dingTalkAtMobiles: dingTalkAtMobilesText.trim(),
    });
    setTestingDingTalkPush(true);
    try {
      const result = await testRemoteDingTalkPush(currentPushConfig());
      showToast(result.ok ? '钉钉测试推送已发送，请查看钉钉群消息' : (result.error || '钉钉测试推送失败'));
    } catch (error: any) {
      showToast(error?.message || '钉钉测试推送失败');
    } finally {
      setTestingDingTalkPush(false);
    }
  }

  function handleSaveWxPusherConfig() {
    const appToken = wxPusherAppTokenText.trim();
    const uid = wxPusherUidText.trim();
    const topicIds = wxPusherTopicIdsText.trim();
    setPromptCacheConfig({
      pushChannel: appToken && (uid || topicIds) ? 'wxpusher' : promptCacheConfig?.pushChannel,
      wxPusherAppToken: appToken,
      wxPusherUid: uid,
      wxPusherTopicIds: topicIds,
    });
    if (appToken && (uid || topicIds)) {
      pushRemotePushConfig({
        ...currentPushConfig(),
        pushChannel: 'wxpusher',
      }).catch(() => undefined);
    }
    showToast(appToken && (uid || topicIds) ? 'WxPusher 推送配置已保存' : 'WxPusher 推送已关闭');
  }

  async function handleTestWxPusherPush() {
    if (testingWxPusherPush) return;
    const appToken = wxPusherAppTokenText.trim();
    const uid = wxPusherUidText.trim();
    const topicIds = wxPusherTopicIdsText.trim();
    if (!appToken || (!uid && !topicIds)) {
      showToast('请先填写 WxPusher AppToken 和 UID/Topic ID');
      return;
    }
    setPromptCacheConfig({
      pushChannel: 'wxpusher',
      wxPusherAppToken: appToken,
      wxPusherUid: uid,
      wxPusherTopicIds: topicIds,
    });
    setTestingWxPusherPush(true);
    try {
      const result = await testRemoteWxPusherPush(currentPushConfig());
      showToast(result.ok ? 'WxPusher 测试推送已发送，请查看微信通知' : (result.error || 'WxPusher 测试推送失败'));
    } catch (error: any) {
      showToast(error?.message || 'WxPusher 测试推送失败');
    } finally {
      setTestingWxPusherPush(false);
    }
  }

  async function handleCheckRemoteKeepaliveServer() {
    if (checkingRemoteKeepalive) return;
    setPromptCacheConfig({
      remoteServerUrl: remoteServerUrlText.trim(),
      remoteAuthToken: remoteAuthTokenText.trim(),
    });
    setCheckingRemoteKeepalive(true);
    try {
      const ok = await checkPromptCacheRemoteServer();
      if (ok) {
        await refreshPromptCacheRemoteServerStatus(conversationId);
      }
      showToast(ok ? '远程保活服务连接正常' : '远程保活服务无响应');
    } catch (error: any) {
      showToast(error?.message || '远程保活服务连接失败');
    } finally {
      setRemoteSnapshotStatus(getPromptCacheRemoteSnapshotStatus());
      setCheckingRemoteKeepalive(false);
    }
  }

  async function handleImportMyphone() {
    if (importingMyphone) return;
    setImportingMyphone(true);
    try {
      const result = await importMyphonePrivateChatsFromPicker();
      if (result.cancelled) return;
      if (result.firstConversationId) {
        await loadConversation(result.firstConversationId);
      }
      showToast(`已导入 ${result.importedMessages} 条消息`);
      Alert.alert(
        '导入完成',
        `已导入 ${result.importedConversations} 个单聊，共 ${result.importedMessages} 条消息。` +
          (result.skippedCharacters > 0 ? `\n跳过 ${result.skippedCharacters} 个空角色。` : '')
      );
    } catch (error: any) {
      Alert.alert('导入失败', error?.message || '无法读取 ephone 单聊备份');
    } finally {
      setImportingMyphone(false);
    }
  }

  async function handlePickFaceReferences() {
    if (pickingFaceReferences) return;
    setPickingFaceReferences(true);
    try {
      const remainingSlots = Math.max(0, IMAGE_GENERATION_FACE_REFERENCE_SELECTION_LIMIT - faceReferences.length);
      if (remainingSlots <= 0) {
        Alert.alert('参考图已满', `最多保存 ${IMAGE_GENERATION_FACE_REFERENCE_SELECTION_LIMIT} 张锁脸参考图。`);
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
        allowsEditing: false,
        allowsMultipleSelection: true,
        selectionLimit: remainingSlots,
        orderedSelection: true,
      });
      if (result.canceled) return;

      const assets = result.assets.slice(0, remainingSlots);
      const validationError = assets
        .map(validateImageGenerationFaceReferenceAsset)
        .find((message): message is string => !!message);
      if (validationError) {
        Alert.alert('图片不适合作为锁脸参考图', validationError);
        return;
      }

      const now = Date.now();
      const copiedReferences: ImageGenerationFaceReference[] = await Promise.all(
        assets.map(async (asset, index) => ({
          id: `face-ref-${now.toString(36)}-${index}-${randomUUID()}`,
          uri: await copyImageGenerationFaceReference(asset),
          enabled: true,
          createdAt: now + index,
        }))
      );
      if (copiedReferences.length === 0) return;

      setImageGenerationConfig({
        faceReferences: [...faceReferences, ...copiedReferences].slice(0, IMAGE_GENERATION_FACE_REFERENCE_SELECTION_LIMIT),
      });
      showToast(`已添加 ${copiedReferences.length} 张锁脸参考图`);
    } catch (error: any) {
      Alert.alert('选择锁脸参考图失败', error?.message || '无法读取所选图片');
    } finally {
      setPickingFaceReferences(false);
    }
  }

  function handleToggleFaceReference(id: string, enabled: boolean) {
    setImageGenerationConfig({
      faceReferences: faceReferences.map((item) =>
        item.id === id ? { ...item, enabled } : item
      ),
    });
  }

  function handleRemoveFaceReference(reference: ImageGenerationFaceReference) {
    setImageGenerationConfig({
      faceReferences: faceReferences.filter((item) => item.id !== reference.id),
    });
    deleteLocalImageIfExists(reference.uri);
    showToast('锁脸参考图已删除');
  }

  const messageCount = messages.filter((m) => m.role === 'user' || m.role === 'assistant').length;
  const loadedFloorFrom = messageCount > 0 ? messageFloorOffset + 1 : 0;
  const loadedFloorTo = messageFloorOffset + messageCount;

  return (
    <ScrollView
      style={styles.content}
      contentContainerStyle={{ paddingBottom: keyboardBottomInset + 20 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* System Prompt */}
      <Text style={styles.sectionTitle}>System Prompt</Text>
      <Text style={styles.hint}>此内容会放在所有消息最前面发送给 AI</Text>
      <TextInput
        style={[styles.input, { minHeight: 100, textAlignVertical: 'top' }]}
        value={promptText}
        onChangeText={setPromptText}
        onBlur={() => setSystemPrompt(promptText.trim())}
        multiline
        placeholder="You are a helpful assistant."
        placeholderTextColor={colors.textTertiary}
      />
      <Text style={styles.label}>发送身份</Text>
      <View style={styles.segmentedRow}>
        {STABLE_PROMPT_ROLE_OPTIONS.map((item) => (
          <Pressable
            key={item.value}
            style={[styles.segmentedButton, (stablePromptRole || 'system') === item.value && styles.segmentedButtonActive]}
            onPress={() => {
              setStablePromptRole(item.value);
              showToast(`System Prompt 将以 ${item.label} 身份发送`);
            }}
          >
            <Text style={[styles.segmentedText, (stablePromptRole || 'system') === item.value && styles.segmentedTextActive]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.hint}>使用 Claude Code OAuth 反代且开启 cloak 时，建议选 User，避免稳定提示词和收藏日记被上游 system cloaking 清洗。</Text>

      <Text style={styles.sectionTitle}>生图配置</Text>
      <Text style={styles.hint}>AI 回复中的 [Pic:图片描述] 会与这里的基础提示词组合后发送给生图 API；这里不会作为真实图片发回给聊天 AI。</Text>
      <TextInput
        style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]}
        value={imagePromptText}
        onChangeText={setImagePromptText}
        onBlur={() => setImageGenerationPrompt(imagePromptText.trim())}
        multiline
        placeholder="例如：高质量图片，画面清晰，主体明确，无水印。"
        placeholderTextColor={colors.textTertiary}
      />

      <View style={styles.imageFaceReferenceHeader}>
        <View style={styles.imageFaceReferenceHeaderText}>
          <Text style={styles.label}>锁脸参考图</Text>
          <Text style={styles.hint}>启用的参考图会自动用于文生图/图生图，和输入框临时参考图一起传给生图 API。</Text>
        </View>
        <Pressable
          style={[styles.smallActionButton, pickingFaceReferences && styles.smallActionButtonDisabled]}
          onPress={handlePickFaceReferences}
          disabled={pickingFaceReferences}
        >
          <Text style={[styles.smallActionText, pickingFaceReferences && styles.smallActionTextDisabled]}>
            {pickingFaceReferences ? '选择中' : '上传'}
          </Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>
        已启用 {enabledFaceReferenceCount} / {faceReferences.length} 张，最多 {IMAGE_GENERATION_FACE_REFERENCE_SELECTION_LIMIT} 张。
      </Text>
      {faceReferences.length === 0 ? (
        <View style={styles.imageFaceReferenceEmpty}>
          <Text style={styles.hint}>暂无锁脸参考图。</Text>
        </View>
      ) : (
        <View style={styles.imageFaceReferenceGrid}>
          {faceReferences.map((reference, index) => {
            const enabled = reference.enabled !== false;
            return (
              <View
                key={reference.id}
                style={[
                  styles.imageFaceReferenceItem,
                  enabled && styles.imageFaceReferenceItemActive,
                ]}
              >
                <Image source={{ uri: reference.uri }} style={styles.imageFaceReferenceImage} resizeMode="cover" />
                <View style={styles.imageFaceReferenceMeta}>
                  <Text style={styles.imageFaceReferenceLabel}>参考图 {index + 1}</Text>
                  <Switch
                    value={enabled}
                    onValueChange={(value) => handleToggleFaceReference(reference.id, value)}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor="#FFFFFF"
                  />
                </View>
                <Pressable
                  style={styles.imageFaceReferenceRemove}
                  onPress={() => handleRemoveFaceReference(reference)}
                >
                  <Text style={styles.imageFaceReferenceRemoveText}>删除</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      )}

      {/* 消息条数 */}
      <Text style={styles.sectionTitle}>当前对话</Text>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>已加载消息</Text>
        <Text style={styles.infoValue}>
          {messageCount > 0 ? `${loadedFloorFrom}-${loadedFloorTo}` : '0'} 条
        </Text>
      </View>

      <Text style={styles.sectionTitle}>ephone 导入</Text>
      <Text style={styles.hint}>选择 ephone 导出的 .ee 或 JSON 单聊备份；只导入角色单聊，群聊会被跳过。</Text>
      <Pressable
        style={[styles.importButton, importingMyphone && styles.importButtonDisabled]}
        onPress={handleImportMyphone}
        disabled={importingMyphone}
      >
        {importingMyphone ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Text style={styles.importButtonText}>导入 ephone 单聊</Text>
        )}
      </Pressable>

      {/* 隐藏消息 */}
      <Text style={styles.sectionTitle}>隐藏消息</Text>
      <Text style={styles.hint}>隐藏的消息不会发送给 AI，可用于节省 token。隐藏范围按对话独立保存，可添加隐藏，也可按范围恢复。</Text>

      {!conversationId ? (
        <Text style={styles.hint}>请先打开一个对话后再设置隐藏范围。</Text>
      ) : (
        <>
          {hasHiddenMessages && (
            <View style={styles.rangeList}>
              <Text style={styles.previewHint}>已隐藏消息</Text>
              {mergedHiddenRanges.map((range) => (
                <View key={`${range.from}-${range.to}`} style={styles.rangeItem}>
                  <Text style={styles.rangeText}>{formatHiddenRange(range)}</Text>
                  <Pressable onPress={() => handleRestoreMergedRange(range)}>
                    <Text style={styles.rangeDelete}>恢复</Text>
                  </Pressable>
                </View>
              ))}
              {hiddenContextRows.length > 0 && (
                <Text style={[styles.previewHint, styles.hiddenContextTitle]}>上下文消息</Text>
              )}
              {hiddenContextRows.map((row) => (
                <View key={row.id} style={styles.rangeItem}>
                  <View style={styles.hiddenMessageText}>
                    <Text style={styles.rangeText}>
                      {row.role ? roleLabel(row.role) : '未加载消息'}
                    </Text>
                    <Text style={styles.previewText} numberOfLines={2}>
                      {row.role !== null && row.content !== null
                        ? `${roleLabel(row.role)}：${snippet(row.content) || '（空消息）'}`
                        : row.id}
                    </Text>
                  </View>
                  <Pressable onPress={() => setMessageHidden(row.id, false)}>
                    <Text style={styles.rangeDelete}>恢复</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          <View style={styles.rangeInputRow}>
            <Text style={styles.rangeLabel}>从第</Text>
            <TextInput style={styles.rangeInput} value={fromStr} onChangeText={setFromStr}
              keyboardType="number-pad" placeholder="X" placeholderTextColor={colors.textTertiary} />
            <Text style={styles.rangeLabel}>条到第</Text>
            <TextInput style={styles.rangeInput} value={toStr} onChangeText={setToStr}
              keyboardType="number-pad" placeholder="Y" placeholderTextColor={colors.textTertiary} />
            <Text style={styles.rangeLabel}>条</Text>
            <Pressable style={styles.rangeAddButton} onPress={handleAddRange}>
              <Text style={styles.rangeAddText}>添加</Text>
            </Pressable>
            <Pressable style={styles.rangeRestoreButton} onPress={handleRestoreRange}>
              <Text style={styles.rangeRestoreText}>恢复</Text>
            </Pressable>
          </View>

          {/* 预览：选定范围的首尾两条消息 */}
          {preview && (
            <View style={styles.previewBox}>
              <Text style={styles.previewHint}>预览所选范围</Text>
              {preview.first ? (
                <View style={styles.previewItem}>
                  <Text style={styles.previewLabel}>
                    第 {preview.from} 条（{roleLabel(preview.first.role)}）
                  </Text>
                  <Text style={styles.previewText} numberOfLines={2}>
                    {snippet(preview.first.content) || '（空消息）'}
                  </Text>
                </View>
              ) : (
                <Text style={styles.previewText}>第 {preview.from} 条超出当前消息范围</Text>
              )}
              {preview.last !== null && (
                preview.last ? (
                  <View style={[styles.previewItem, { marginTop: 8 }]}>
                    <Text style={styles.previewLabel}>
                      第 {preview.to} 条（{roleLabel(preview.last.role)}）
                    </Text>
                    <Text style={styles.previewText} numberOfLines={2}>
                      {snippet(preview.last.content) || '（空消息）'}
                    </Text>
                  </View>
                ) : (
                  <Text style={[styles.previewText, { marginTop: 8 }]}>
                    第 {preview.to} 条超出当前消息范围
                  </Text>
                )
              )}
            </View>
          )}
        </>
      )}

      {/* AI 输出字数限制 */}
      <Text style={styles.sectionTitle}>AI 输出限制</Text>
      <Text style={styles.hint}>限制 AI 单次回复的最大 token 数，留空则不限制</Text>
      <View style={styles.modelRow}>
        <TextInput style={[styles.input, { flex: 1 }]} value={tokensStr} onChangeText={setTokensStr}
          keyboardType="number-pad" placeholder="不限制" placeholderTextColor={colors.textTertiary} />
        <Pressable style={styles.fetchButton} onPress={handleSaveTokens}>
          <Text style={styles.fetchButtonText}>保存</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>Token 预警</Text>
      <Text style={styles.hint}>当一次发送触发的 API 调用 total tokens 超过该数值时，弹窗提醒压缩总结对话；留空则关闭预警</Text>
      <View style={styles.modelRow}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={tokenWarningStr}
          onChangeText={setTokenWarningStr}
          keyboardType="number-pad"
          placeholder="关闭预警"
          placeholderTextColor={colors.textTertiary}
        />
        <Pressable style={styles.fetchButton} onPress={handleSaveTokenWarning}>
          <Text style={styles.fetchButtonText}>保存</Text>
        </Pressable>
      </View>

      {/* 不发送思维链 */}
      <Text style={styles.sectionTitle}>思维链</Text>
      <Text style={styles.hint}>开启后，AI 历史消息中的思维链内容不会发送给 AI，但仍会正常存储和显示，可节省 token</Text>
      <View style={styles.switchRow}>
        <Text style={styles.label}>不发送思维链</Text>
        <Switch
          value={stripThinking}
          onValueChange={setStripThinking}
          trackColor={{ true: colors.primary }}
        />
      </View>

      <Text style={styles.sectionTitle}>Prompt 缓存</Text>
      <Text style={styles.hint}>开启后，请求会透传 session_id，并在稳定的 system prompt 与历史对话末尾添加 cache_control。仅在你的 API 中转支持该字段时开启。</Text>
      <View style={styles.switchRow}>
        <Text style={styles.label}>启用 cache_control</Text>
        <Switch
          value={!!promptCacheConfig?.enabled}
          onValueChange={(value) => {
            setPromptCacheConfig({ enabled: value });
            if (!value && conversationId) {
              disablePromptCacheRemoteKeepalive(conversationId).catch(() => undefined);
            }
            showToast(value ? 'Prompt 缓存已开启' : 'Prompt 缓存已关闭');
          }}
          trackColor={{ true: colors.primary }}
        />
      </View>
      <Text style={styles.label}>缓存时间</Text>
      <View style={styles.segmentedRow}>
        {PROMPT_CACHE_TTL_OPTIONS.map((item) => (
          <Pressable
            key={item.value}
            style={[styles.segmentedButton, promptCacheTtl === item.value && styles.segmentedButtonActive]}
            onPress={() => {
              setPromptCacheConfig({ ttl: item.value });
              if (item.value !== '1h' && conversationId) {
                disablePromptCacheRemoteKeepalive(conversationId).catch(() => undefined);
              }
              showToast(`Prompt 缓存时间已设为 ${item.label}`);
            }}
          >
            <Text style={[styles.segmentedText, promptCacheTtl === item.value && styles.segmentedTextActive]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.hint}>5min 使用 Claude 默认短缓存；1h 会在 cache_control 中附加 ttl。</Text>

      <View style={styles.remoteKeepalivePanel}>
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.label}>远程保活</Text>
            <Text style={styles.hint}>开启后同步当前或已有 1h cache 快照到服务端；关闭会立即停用服务端保活。</Text>
          </View>
          <Switch
            value={!!promptCacheConfig?.remoteKeepaliveEnabled}
            onValueChange={(value) => void handleToggleRemoteKeepalive(value)}
            disabled={switchingRemoteKeepalive}
            trackColor={{ true: colors.primary }}
          />
        </View>
        <Text style={styles.hint}>远程服务会保存最后一次成功使用 1h cache 的请求快照，并按 55 分钟自动调用保活。自托管时会在服务端保存 API Key 和对话快照。</Text>
          <Text style={styles.label}>服务地址</Text>
          <TextInput
            style={styles.input}
            value={remoteServerUrlText}
            onChangeText={setRemoteServerUrlText}
            onBlur={handleSaveRemoteKeepaliveConfig}
            placeholder="http://你的服务器:8789"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
          />
          <Text style={styles.label}>访问令牌</Text>
          <TextInput
            style={styles.input}
            value={remoteAuthTokenText}
            onChangeText={setRemoteAuthTokenText}
            onBlur={handleSaveRemoteKeepaliveConfig}
            placeholder="KEEPALIVE_AUTH_TOKEN"
            placeholderTextColor={colors.textTertiary}
            secureTextEntry
            autoCapitalize="none"
          />
          <Pressable
            style={[styles.importButton, checkingRemoteKeepalive && styles.importButtonDisabled]}
            onPress={handleCheckRemoteKeepaliveServer}
            disabled={checkingRemoteKeepalive}
          >
            {checkingRemoteKeepalive ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.importButtonText}>测试远程服务</Text>
            )}
          </Pressable>
          <Text style={styles.label}>推送渠道</Text>
          <View style={styles.segmentedRow}>
            {PROMPT_CACHE_PUSH_CHANNEL_OPTIONS.map((item) => (
              <Pressable
                key={item.value}
                style={[styles.segmentedButton, (promptCacheConfig?.pushChannel || 'dingtalk') === item.value && styles.segmentedButtonActive]}
                onPress={() => {
                  setPromptCacheConfig({ pushChannel: item.value });
                  pushRemotePushConfig({
                    ...currentPushConfig(),
                    pushChannel: item.value,
                  }).catch(() => undefined);
                }}
              >
                <Text style={[styles.segmentedText, (promptCacheConfig?.pushChannel || 'dingtalk') === item.value && styles.segmentedTextActive]}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.label}>钉钉机器人 Webhook</Text>
          <Text style={styles.hint}>AI 主动留言时通过钉钉群机器人发送到钉钉 App。建议在钉钉里建一个只给自己的提醒群，机器人安全设置使用加签。</Text>
          <TextInput
            style={styles.input}
            value={dingTalkWebhookText}
            onChangeText={setDingTalkWebhookText}
            onBlur={handleSaveDingTalkConfig}
            placeholder="https://oapi.dingtalk.com/robot/send?access_token=..."
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            keyboardType="url"
          />
          <Text style={styles.label}>钉钉加签 Secret（可选）</Text>
          <TextInput
            style={styles.input}
            value={dingTalkSecretText}
            onChangeText={setDingTalkSecretText}
            onBlur={handleSaveDingTalkConfig}
            placeholder="SECxxxxxxxxxxxxxxxxxxxxxxxx"
            placeholderTextColor={colors.textTertiary}
            secureTextEntry
            autoCapitalize="none"
          />
          <Text style={styles.label}>@ 手机号（可选）</Text>
          <TextInput
            style={styles.input}
            value={dingTalkAtMobilesText}
            onChangeText={setDingTalkAtMobilesText}
            onBlur={handleSaveDingTalkConfig}
            placeholder="13800138000,13900139000"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            keyboardType="numbers-and-punctuation"
          />
          <Pressable
            style={[styles.importButton, testingDingTalkPush && styles.importButtonDisabled]}
            onPress={handleTestDingTalkPush}
            disabled={testingDingTalkPush}
          >
            {testingDingTalkPush ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.importButtonText}>测试钉钉推送</Text>
            )}
          </Pressable>
          <Text style={styles.label}>WxPusher AppToken</Text>
          <Text style={styles.hint}>适合在一加等杀后台严格的手机上作为稳定回退；通知来自 WxPusher/微信，点击后可跳转到 YSClaude 对话。</Text>
          <TextInput
            style={styles.input}
            value={wxPusherAppTokenText}
            onChangeText={setWxPusherAppTokenText}
            onBlur={handleSaveWxPusherConfig}
            placeholder="AT_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            placeholderTextColor={colors.textTertiary}
            secureTextEntry
            autoCapitalize="none"
          />
          <Text style={styles.label}>WxPusher UID</Text>
          <TextInput
            style={styles.input}
            value={wxPusherUidText}
            onChangeText={setWxPusherUidText}
            onBlur={handleSaveWxPusherConfig}
            placeholder="UID_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
          />
          <Text style={styles.label}>WxPusher Topic IDs（可选）</Text>
          <TextInput
            style={styles.input}
            value={wxPusherTopicIdsText}
            onChangeText={setWxPusherTopicIdsText}
            onBlur={handleSaveWxPusherConfig}
            placeholder="123,456"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            keyboardType="numbers-and-punctuation"
          />
          <Pressable
            style={[styles.importButton, testingWxPusherPush && styles.importButtonDisabled]}
            onPress={handleTestWxPusherPush}
            disabled={testingWxPusherPush}
          >
            {testingWxPusherPush ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.importButtonText}>测试 WxPusher 推送</Text>
            )}
          </Pressable>
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.label}>远程自主活动</Text>
              <Text style={styles.hint}>开启后服务端保活时会告知 AI 已过去的时间，由它自主决定是否留言或记录活动；关闭则仅做缓存续期。修改将在下一次快照同步后生效。</Text>
            </View>
            <Switch
              value={promptCacheConfig?.remoteAgentTickEnabled !== false}
              onValueChange={(value) => {
                setPromptCacheConfig({ remoteAgentTickEnabled: value });
                showToast(value ? '远程自主活动已开启' : '远程自主活动已关闭');
              }}
              trackColor={{ true: colors.primary }}
            />
          </View>
          <View style={styles.remoteSnapshotStatus}>
            <View style={styles.remoteSnapshotHeader}>
              <Text style={styles.previewHint}>当前快照</Text>
              <Text
                style={[
                  styles.remoteSnapshotState,
                  remoteSnapshotStatus.state === 'syncing' && styles.remoteSnapshotStatePending,
                  remoteSnapshotStatus.state === 'pending' && styles.remoteSnapshotStatePending,
                  remoteSnapshotStatus.state === 'synced' && styles.remoteSnapshotStateSynced,
                  remoteSnapshotStatus.state === 'failed' && styles.remoteSnapshotStateFailed,
                ]}
              >
                {formatRemoteSnapshotState()}
              </Text>
            </View>
            <Text style={styles.remoteSnapshotMeta}>
              {formatRemoteSnapshotSourceMeta()}
              {remoteSnapshotStatus.model ? ` · ${remoteSnapshotStatus.model}` : ''}
              {remoteSnapshotStatus.messageCount > 0 ? ` · ${remoteSnapshotStatus.messageCount} 条消息` : ''}
            </Text>
            {formatRemoteServerStatus() ? (
              <Text style={styles.remoteSnapshotMeta}>
                {formatRemoteServerStatus()}
                {formatSnapshotHash(remoteSnapshotStatus.serverSnapshotHash) ? ` · #${formatSnapshotHash(remoteSnapshotStatus.serverSnapshotHash)}` : ''}
                {remoteSnapshotStatus.serverConversationCount > 1 ? ` · 共 ${remoteSnapshotStatus.serverConversationCount} 个会话` : ''}
              </Text>
            ) : null}
            {remoteSnapshotStatus.lastMessageTail ? (
              <Text style={styles.remoteSnapshotText} numberOfLines={3}>
                {remoteSnapshotStatus.lastMessageRole ? `${roleLabel(remoteSnapshotStatus.lastMessageRole)}：` : ''}
                {remoteSnapshotStatus.lastMessageTail}
              </Text>
            ) : (
              <Text style={styles.remoteSnapshotText}>暂无待展示的消息片段</Text>
            )}
            <Text style={styles.hint}>{formatRemoteSnapshotTime()}</Text>
            {remoteSnapshotStatus.serverNextKeepaliveAt ? (
              <Text style={styles.hint}>服务端下次保活 {formatFullTime(remoteSnapshotStatus.serverNextKeepaliveAt)}</Text>
            ) : null}
            {remoteSnapshotStatus.serverLastTouchedAt ? (
              <Text style={styles.hint}>服务端最近保活 {formatFullTime(remoteSnapshotStatus.serverLastTouchedAt)}</Text>
            ) : null}
            {remoteSnapshotStatus.serverPendingMessageCount > 0 || remoteSnapshotStatus.serverActivityCount > 0 ? (
              <Text style={styles.hint}>
                待收件 {remoteSnapshotStatus.serverPendingMessageCount} · 自主活动 {remoteSnapshotStatus.serverActivityCount}
              </Text>
            ) : null}
            {remoteSnapshotStatus.lastSyncError ? (
              <Text style={styles.remoteSnapshotError} numberOfLines={3}>
                {remoteSnapshotStatus.lastSyncError}
              </Text>
            ) : null}
            {remoteSnapshotStatus.serverLastError ? (
              <Text style={styles.remoteSnapshotError} numberOfLines={3}>
                服务端保活失败：{remoteSnapshotStatus.serverLastError}
              </Text>
            ) : null}
            {remoteSnapshotStatus.serverStatusError ? (
              <Text style={styles.remoteSnapshotError} numberOfLines={3}>
                状态读取失败：{remoteSnapshotStatus.serverStatusError}
              </Text>
            ) : null}
            <View style={styles.remoteSnapshotActions}>
              <Pressable
                style={[
                  styles.smallActionButton,
                  styles.remoteSnapshotFlushButton,
                  refreshingRemoteServerStatus && styles.smallActionButtonDisabled,
                ]}
                onPress={handleRefreshRemoteServerStatus}
                disabled={refreshingRemoteServerStatus}
              >
                <Text style={[styles.smallActionText, refreshingRemoteServerStatus && styles.smallActionTextDisabled]}>
                  {refreshingRemoteServerStatus ? '刷新中' : '刷新服务器状态'}
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.smallActionButton,
                  styles.remoteSnapshotFlushButton,
                  (flushingRemoteSnapshot || remoteSnapshotStatus.queueCount <= 0) && styles.smallActionButtonDisabled,
                ]}
                onPress={handleFlushRemoteSnapshotNow}
                disabled={flushingRemoteSnapshot || remoteSnapshotStatus.queueCount <= 0}
              >
                <Text
                  style={[
                    styles.smallActionText,
                    (flushingRemoteSnapshot || remoteSnapshotStatus.queueCount <= 0) && styles.smallActionTextDisabled,
                  ]}
                >
                  {flushingRemoteSnapshot || remoteSnapshotStatus.state === 'syncing' ? '同步中' : '立即同步快照'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>

      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.label}>非保活时段</Text>
          <Text style={styles.hint}>远程保活点落在该时段内时，取消本轮保活。</Text>
        </View>
        <Switch
          value={!!promptCacheConfig?.quietHoursEnabled}
          onValueChange={(value) => {
            setPromptCacheConfig({ quietHoursEnabled: value });
            showToast(value ? '远程保活勿扰已开启' : '远程保活勿扰已关闭');
          }}
          trackColor={{ true: colors.primary }}
        />
      </View>

      {!!promptCacheConfig?.quietHoursEnabled && (
        <View style={styles.promptCacheQuietPanel}>
          <View style={styles.promptCacheQuietField}>
            <Text style={styles.label}>开始</Text>
            <TextInput
              style={styles.input}
              value={quietStartText}
              onChangeText={setQuietStartText}
              onBlur={handleSavePromptCacheQuietHours}
              keyboardType="numbers-and-punctuation"
              placeholder="23:00"
              placeholderTextColor={colors.textTertiary}
            />
          </View>
          <View style={styles.promptCacheQuietField}>
            <Text style={styles.label}>结束</Text>
            <TextInput
              style={styles.input}
              value={quietEndText}
              onChangeText={setQuietEndText}
              onBlur={handleSavePromptCacheQuietHours}
              keyboardType="numbers-and-punctuation"
              placeholder="07:00"
              placeholderTextColor={colors.textTertiary}
            />
          </View>
        </View>
      )}

      <Text style={styles.sectionTitle}>生理信息</Text>
      <Text style={styles.hint}>开启后，仅在预计生理期前两天或经期内，把本地记录推算出的简短提醒附带给 AI。默认关闭。</Text>
      <View style={styles.switchRow}>
        <Text style={styles.label}>发送生理提醒给 AI</Text>
        <Switch
          value={!!periodConfig?.sendToAI}
          onValueChange={(value) => {
            setPeriodConfig({ sendToAI: value });
            showToast(value ? '生理提醒会按条件发送给 AI' : '生理提醒已停止发送给 AI');
          }}
          trackColor={{ true: colors.primary }}
        />
      </View>
    </ScrollView>
  );
}
