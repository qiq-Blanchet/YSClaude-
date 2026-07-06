import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSettingsPageColors } from '../../theme/colors';
import {
  useSettingsStore,
  type NamedAPIConfig,
  type PromptCacheCompatibility,
  type ThinkingCompatibility,
  type ThinkingEffort,
} from '../../stores/settings';
import { applyThinkingConfig } from '../../services/api';
import { createAndShareBackup, pickBackupFile, restoreBackup, type PickedBackup } from '../../services/backup';
import { formatFullTime } from '../../utils/time';
import { createSettingsStyles } from './styles';

type SettingsTabProps = {
  showToast: (message: string) => void;
  keyboardBottomInset: number;
};

const IMAGE_SIZE_OPTIONS = ['auto', '1024x1024', '1536x1024', '1024x1536'] as const;
const IMAGE_QUALITY_OPTIONS = ['auto', 'low', 'medium', 'high'] as const;
const PROMPT_CACHE_COMPATIBILITY_OPTIONS: Array<{ value: PromptCacheCompatibility; label: string }> = [
  { value: 'standard', label: '标准' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'nanogpt', label: 'NanoGPT' },
];
const THINKING_COMPATIBILITY_OPTIONS: Array<{ value: ThinkingCompatibility; label: string }> = [
  { value: 'standard', label: '标准' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'nanogpt', label: 'NanoGPT' },
];
const THINKING_EFFORT_OPTIONS: Array<{ value: ThinkingEffort; label: string }> = [
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
];
type ModelPickerTarget = 'chat' | 'image';
type ImageOptionTarget = 'size' | 'quality';

export function APIConfigTab({ showToast, keyboardBottomInset }: SettingsTabProps) {
  const colors = useSettingsPageColors();
  const styles = useMemo(() => createSettingsStyles(colors), [colors]);
  const router = useRouter();
  const {
    _hydrated,
    apiConfigs,
    activeConfigIndex,
    imageGenerationConfig,
    saveAPIConfig,
    removeAPIConfig,
    setActiveConfig,
    setImageGenerationConfig,
  } = useSettingsStore();

  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [temperature, setTemperature] = useState('');
  const [generateThinking, setGenerateThinking] = useState(false);
  const [returnNativeThinking, setReturnNativeThinking] = useState(false);
  const [thinkingEffort, setThinkingEffort] = useState<ThinkingEffort>('high');
  const [thinkingCompatibility, setThinkingCompatibility] = useState<ThinkingCompatibility>('standard');
  const [promptCacheCompatibility, setPromptCacheCompatibility] = useState<PromptCacheCompatibility>('standard');
  const [imageEnabled, setImageEnabled] = useState(imageGenerationConfig?.enabled ?? false);
  const [imageBaseUrl, setImageBaseUrl] = useState(imageGenerationConfig?.baseUrl || '');
  const [imageApiKey, setImageApiKey] = useState(imageGenerationConfig?.apiKey || '');
  const [imageModel, setImageModel] = useState(imageGenerationConfig?.model || 'gpt-image-2');
  const [imageSize, setImageSize] = useState(imageGenerationConfig?.size || '1024x1024');
  const [imageQuality, setImageQuality] = useState(imageGenerationConfig?.quality || 'auto');
  const [models, setModels] = useState<string[]>([]);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelPickerTarget, setModelPickerTarget] = useState<ModelPickerTarget>('chat');
  const [showImageOptionPicker, setShowImageOptionPicker] = useState<ImageOptionTarget | null>(null);
  const [testing, setTesting] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);

  useEffect(() => {
    if (_hydrated && apiConfigs.length > 0) {
      loadConfig(activeConfigIndex);
    }
  }, [_hydrated]);

  useEffect(() => {
    if (!_hydrated) return;
    setImageEnabled(imageGenerationConfig?.enabled ?? false);
    setImageBaseUrl(imageGenerationConfig?.baseUrl || '');
    setImageApiKey(imageGenerationConfig?.apiKey || '');
    setImageModel(imageGenerationConfig?.model || 'gpt-image-2');
    setImageSize(imageGenerationConfig?.size || '1024x1024');
    setImageQuality(imageGenerationConfig?.quality || 'auto');
  }, [_hydrated, imageGenerationConfig]);

  function loadConfig(index: number) {
    const config = apiConfigs[index];
    if (config) {
      setName(config.name);
      setBaseUrl(config.baseUrl);
      setApiKey(config.apiKey);
      setModel(config.model);
      setTemperature(typeof config.temperature === 'number' ? String(config.temperature) : '');
      setGenerateThinking(!!config.generateThinking);
      setReturnNativeThinking(!!config.returnNativeThinking);
      setThinkingEffort(config.thinkingEffort || 'high');
      setThinkingCompatibility(config.thinkingCompatibility || 'standard');
      setPromptCacheCompatibility(config.promptCacheCompatibility || 'standard');
    }
  }

  function handleNew() {
    setName('');
    setBaseUrl('');
    setApiKey('');
    setModel('');
    setTemperature('');
    setGenerateThinking(false);
    setReturnNativeThinking(false);
    setThinkingEffort('high');
    setThinkingCompatibility('standard');
    setPromptCacheCompatibility('standard');
    setModels([]);
  }

  function resolveModelFetchCredentials(target: ModelPickerTarget) {
    if (target === 'chat') {
      return {
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
      };
    }

    const activeConfig = apiConfigs[activeConfigIndex];
    return {
      baseUrl: imageBaseUrl.trim() || activeConfig?.baseUrl?.trim() || '',
      apiKey: imageApiKey.trim() || activeConfig?.apiKey?.trim() || '',
    };
  }

  function parseOptionalTemperature(value: string): number | undefined | null {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 2) return null;
    return parsed;
  }

  async function handleFetchModels(target: ModelPickerTarget = 'chat') {
    const credentials = resolveModelFetchCredentials(target);
    if (!credentials.baseUrl || !credentials.apiKey) {
      Alert.alert('提示', '请先填写 Base URL 和 API Key');
      return;
    }
    setFetching(true);
    try {
      const url = `${credentials.baseUrl.replace(/\/$/, '')}/models`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${credentials.apiKey}` },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const ids: string[] = (data.data || []).map((m: any) => m.id).sort();
      if (ids.length === 0) {
        Alert.alert('提示', '未获取到模型列表');
      } else {
        setModels(ids);
        setModelPickerTarget(target);
        setShowModelPicker(true);
      }
    } catch (e: any) {
      Alert.alert('获取失败', e.message);
    } finally {
      setFetching(false);
    }
  }

  async function handleTest() {
    if (!baseUrl || !apiKey || !model) {
      Alert.alert('提示', '请填写完整配置');
      return;
    }
    setTesting(true);
    try {
      const parsedTemperature = parseOptionalTemperature(temperature);
      if (parsedTemperature === null) {
        Alert.alert('提示', 'temperature 必须是 0 到 2 之间的数字，或留空使用服务默认值');
        return;
      }
      const url = `${baseUrl.trim().replace(/\/$/, '')}/chat/completions`;
      const body: Record<string, any> = {
        model: model.trim(),
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: generateThinking ? 64 : 5,
        ...(parsedTemperature !== undefined ? { temperature: parsedTemperature } : {}),
      };
      applyThinkingConfig(body, generateThinking, thinkingCompatibility, thinkingEffort);
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${text.slice(0, 100)}`);
      }
      showToast('API 配置有效');
    } catch (e: any) {
      Alert.alert('连接失败', e.message);
    } finally {
      setTesting(false);
    }
  }

  function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) { Alert.alert('提示', '请输入配置名称'); return; }
    if (!baseUrl.trim() || !apiKey.trim() || !model.trim()) {
      Alert.alert('提示', '请填写完整配置'); return;
    }
    const parsedTemperature = parseOptionalTemperature(temperature);
    if (parsedTemperature === null) {
      Alert.alert('提示', 'temperature 必须是 0 到 2 之间的数字，或留空使用服务默认值');
      return;
    }
    const config: NamedAPIConfig = {
      name: trimmedName, baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim(),
      ...(parsedTemperature !== undefined ? { temperature: parsedTemperature } : {}),
      generateThinking,
      thinkingEffort,
      returnNativeThinking,
      thinkingCompatibility,
      promptCacheCompatibility,
    };
    saveAPIConfig(config);
    const newIndex = useSettingsStore.getState().apiConfigs.findIndex((c) => c.name === trimmedName);
    if (newIndex >= 0) setActiveConfig(newIndex);
    showToast(`配置「${trimmedName}」已保存`);
  }

  function handleUseCurrentChatAPIForImage() {
    const config = apiConfigs[activeConfigIndex];
    if (!config) {
      Alert.alert('提示', '请先保存一个聊天 API 配置');
      return;
    }
    setImageBaseUrl(config.baseUrl);
    setImageApiKey(config.apiKey);
    showToast('已填入当前聊天 API 的 Base URL 和 Key');
  }

  function handleSaveImageAPI() {
    setImageGenerationConfig({
      enabled: imageEnabled,
      baseUrl: imageBaseUrl.trim(),
      apiKey: imageApiKey.trim(),
      model: imageModel.trim() || 'gpt-image-2',
      size: imageSize || '1024x1024',
      quality: imageQuality || 'auto',
    });
    showToast(imageEnabled ? '生图 API 已保存并启用' : '生图 API 已保存');
  }

  function handleSelectModel(item: string) {
    if (modelPickerTarget === 'image') {
      setImageModel(item);
    } else {
      setModel(item);
    }
    setShowModelPicker(false);
  }

  function handleSelectImageOption(item: string) {
    if (showImageOptionPicker === 'quality') {
      setImageQuality(item);
    } else {
      setImageSize(item);
    }
    setShowImageOptionPicker(null);
  }

  function handleSelectConfig(index: number) {
    setActiveConfig(index);
    loadConfig(index);
  }

  function handleDeleteConfig(index: number) {
    const config = apiConfigs[index];
    Alert.alert('删除配置', `确定删除「${config.name}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除', style: 'destructive',
        onPress: () => {
          removeAPIConfig(index);
          if (apiConfigs.length > 1) loadConfig(0);
          else handleNew();
        },
      },
    ]);
  }

  async function handleCreateBackup() {
    if (creatingBackup || restoringBackup) return;
    setCreatingBackup(true);
    try {
      const result = await createAndShareBackup();
      showToast(result.shared ? '备份包已创建，请选择 Google Drive 保存' : '备份包已创建');
      if (!result.shared) {
        Alert.alert('备份已创建', `文件已保存到本机：\n${result.uri}`);
      }
    } catch (error: any) {
      Alert.alert('创建备份失败', error?.message || '无法创建备份包');
    } finally {
      setCreatingBackup(false);
    }
  }

  async function handlePickRestoreBackup() {
    if (creatingBackup || restoringBackup) return;
    setRestoringBackup(true);
    try {
      const backup = await pickBackupFile();
      if (!backup) {
        setRestoringBackup(false);
        return;
      }
      Alert.alert(
        '覆盖恢复备份',
        [
          `文件：${backup.fileName}`,
          `创建时间：${formatBackupTime(backup.manifest.createdAt)}`,
          `App 版本：${backup.manifest.appVersion}`,
          '',
          '恢复会覆盖当前本地数据。继续前会自动保存一份恢复前快照。',
        ].join('\n'),
        [
          {
            text: '取消',
            style: 'cancel',
            onPress: () => setRestoringBackup(false),
          },
          {
            text: '覆盖恢复',
            style: 'destructive',
            onPress: () => confirmRestoreBackup(backup),
          },
        ]
      );
    } catch (error: any) {
      setRestoringBackup(false);
      Alert.alert('读取备份失败', error?.message || '无法读取备份包');
    }
  }

  async function confirmRestoreBackup(backup: PickedBackup) {
    try {
      const result = await restoreBackup(backup);
      Alert.alert(
        '恢复完成',
        [
          `已恢复 ${formatBackupTime(result.manifest.createdAt)} 创建的备份。`,
          `恢复前快照已保存在：\n${result.localSnapshotUri}`,
          '',
          '请完全关闭并重新打开 App，让设置和数据库重新加载。',
        ].join('\n')
      );
    } catch (error: any) {
      Alert.alert('恢复失败', error?.message || '无法覆盖恢复备份');
    } finally {
      setRestoringBackup(false);
    }
  }

  function formatBackupTime(value: string): string {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? formatFullTime(timestamp) : value;
  }

  if (!_hydrated) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.content}
      contentContainerStyle={{ paddingBottom: keyboardBottomInset + 20 }}
      keyboardShouldPersistTaps="handled"
    >
      {apiConfigs.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>已保存配置</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.configList}>
            {apiConfigs.map((c, i) => (
              <Pressable
                key={i}
                style={[styles.configChip, i === activeConfigIndex && styles.configChipActive]}
                onPress={() => handleSelectConfig(i)}
                onLongPress={() => handleDeleteConfig(i)}
              >
                <Text style={[styles.configChipText, i === activeConfigIndex && styles.configChipTextActive]}>
                  {c.name}
                </Text>
              </Pressable>
            ))}
            <Pressable style={styles.configChip} onPress={handleNew}>
              <Text style={styles.configChipText}>＋ 新建</Text>
            </Pressable>
          </ScrollView>
        </>
      )}

      <Text style={styles.sectionTitle}>API 配置</Text>
      <View style={styles.field}>
        <Text style={styles.label}>配置名称</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName}
          placeholder="例如：Claude 中转" placeholderTextColor={colors.textTertiary} />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Base URL</Text>
        <TextInput style={styles.input} value={baseUrl} onChangeText={setBaseUrl}
          placeholder="https://api.openai.com/v1" placeholderTextColor={colors.textTertiary} autoCapitalize="none" />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>API Key</Text>
        <TextInput style={styles.input} value={apiKey} onChangeText={setApiKey}
          placeholder="sk-..." placeholderTextColor={colors.textTertiary} secureTextEntry autoCapitalize="none" />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Model</Text>
        <View style={styles.modelRow}>
          <TextInput style={[styles.input, { flex: 1 }]} value={model} onChangeText={setModel}
            placeholder="claude-sonnet-4-6" placeholderTextColor={colors.textTertiary} autoCapitalize="none" />
          <Pressable style={styles.fetchButton} onPress={() => handleFetchModels('chat')} disabled={fetching}>
            {fetching ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={styles.fetchButtonText}>拉取</Text>}
          </Pressable>
        </View>
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Temperature</Text>
        <TextInput
          style={styles.input}
          value={temperature}
          onChangeText={setTemperature}
          keyboardType="decimal-pad"
          placeholder="留空使用服务默认值"
          placeholderTextColor={colors.textTertiary}
        />
      </View>
      <Text style={styles.label}>Thinking 强度</Text>
      <View style={styles.segmentedRow}>
        {THINKING_EFFORT_OPTIONS.map((item) => (
          <Pressable
            key={item.value}
            style={[styles.segmentedButton, thinkingEffort === item.value && styles.segmentedButtonActive]}
            onPress={() => setThinkingEffort(item.value)}
          >
            <Text style={[styles.segmentedText, thinkingEffort === item.value && styles.segmentedTextActive]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.hint}>强度越高通常思考更充分，但可能更慢、消耗更多 reasoning tokens。</Text>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.label}>让 AI 生成思维链</Text>
          <Text style={styles.hint}>开启后，请求会按下方渠道附加 reasoning 参数。</Text>
        </View>
        <Switch
          value={generateThinking}
          onValueChange={setGenerateThinking}
          trackColor={{ false: colors.inputBorder, true: colors.primary }}
          thumbColor="#FFFFFF"
        />
      </View>
      <Text style={styles.label}>Thinking 渠道</Text>
      <View style={styles.segmentedRow}>
        {THINKING_COMPATIBILITY_OPTIONS.map((item) => (
          <Pressable
            key={item.value}
            style={[styles.segmentedButton, thinkingCompatibility === item.value && styles.segmentedButtonActive]}
            onPress={() => setThinkingCompatibility(item.value)}
          >
            <Text style={[styles.segmentedText, thinkingCompatibility === item.value && styles.segmentedTextActive]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.hint}>标准和 OpenRouter 使用 reasoning.effort；NanoGPT 额外发送 reasoning_effort。</Text>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.label}>返回原生思维链</Text>
          <Text style={styles.hint}>开启后会显示兼容接口返回的 reasoning_content；关闭后忽略该字段。</Text>
        </View>
        <Switch
          value={returnNativeThinking}
          onValueChange={setReturnNativeThinking}
          trackColor={{ false: colors.inputBorder, true: colors.primary }}
          thumbColor="#FFFFFF"
        />
      </View>
      <Text style={styles.label}>Prompt 缓存渠道</Text>
      <View style={styles.segmentedRow}>
        {PROMPT_CACHE_COMPATIBILITY_OPTIONS.map((item) => (
          <Pressable
            key={item.value}
            style={[styles.segmentedButton, promptCacheCompatibility === item.value && styles.segmentedButtonActive]}
            onPress={() => setPromptCacheCompatibility(item.value)}
          >
            <Text style={[styles.segmentedText, promptCacheCompatibility === item.value && styles.segmentedTextActive]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.hint}>OpenRouter 直接透传 inline cache_control；NanoGPT 会额外发送 promptCaching 与 1h beta header。</Text>

      <View style={styles.actions}>
        <Pressable style={styles.testButton} onPress={handleTest} disabled={testing}>
          {testing ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.testButtonText}>测试连接</Text>}
        </Pressable>
        <Pressable style={styles.saveButton} onPress={handleSave}>
          <Text style={styles.saveButtonText}>保存配置</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>AI 生图 API</Text>
      <Text style={styles.hint}>识别 AI 回复里的 [Pic:图片描述] 后调用 OpenAI 兼容生图接口；有参考图或锁脸图时会走 /images/edits。Base URL 和 Key 留空时会沿用当前聊天 API 配置。</Text>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.label}>启用 AI 生图</Text>
          <Text style={styles.hint}>关闭后 [Pic:...] 只按普通文本保留，不会生成图片。</Text>
        </View>
        <Switch
          value={imageEnabled}
          onValueChange={setImageEnabled}
          trackColor={{ false: colors.inputBorder, true: colors.primary }}
          thumbColor="#FFFFFF"
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Base URL</Text>
        <TextInput
          style={styles.input}
          value={imageBaseUrl}
          onChangeText={setImageBaseUrl}
          placeholder="留空沿用当前聊天 API"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>API Key</Text>
        <TextInput
          style={styles.input}
          value={imageApiKey}
          onChangeText={setImageApiKey}
          placeholder="留空沿用当前聊天 API"
          placeholderTextColor={colors.textTertiary}
          secureTextEntry
          autoCapitalize="none"
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>生图模型</Text>
        <View style={styles.modelRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={imageModel}
            onChangeText={setImageModel}
            placeholder="gpt-image-2"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
          />
          <Pressable style={styles.fetchButton} onPress={() => handleFetchModels('image')} disabled={fetching}>
            {fetching ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={styles.fetchButtonText}>拉取</Text>}
          </Pressable>
        </View>
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>图片尺寸</Text>
        <Pressable style={styles.selectInput} onPress={() => setShowImageOptionPicker('size')}>
          <Text style={styles.selectInputText}>{imageSize}</Text>
          <Text style={styles.selectInputChevron}>⌄</Text>
        </Pressable>
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>图片质量</Text>
        <Pressable style={styles.selectInput} onPress={() => setShowImageOptionPicker('quality')}>
          <Text style={styles.selectInputText}>{imageQuality}</Text>
          <Text style={styles.selectInputChevron}>⌄</Text>
        </Pressable>
      </View>
      <View style={styles.actions}>
        <Pressable style={styles.testButton} onPress={handleUseCurrentChatAPIForImage}>
          <Text style={styles.testButtonText}>沿用当前 API</Text>
        </Pressable>
        <Pressable style={styles.saveButton} onPress={handleSaveImageAPI}>
          <Text style={styles.saveButtonText}>保存生图 API</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>数据备份</Text>
      <View style={styles.backupPanel}>
        <Text style={styles.hint}>
          创建完整备份包后可分享到 Google Drive；恢复时从 Google Drive 选择备份 zip，并覆盖当前本地数据。
        </Text>
        <View style={styles.backupActions}>
          <Pressable
            style={[styles.backupPrimaryButton, (creatingBackup || restoringBackup) && styles.importButtonDisabled]}
            onPress={handleCreateBackup}
            disabled={creatingBackup || restoringBackup}
          >
            {creatingBackup ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.saveButtonText}>创建备份并分享</Text>
            )}
          </Pressable>
          <Pressable
            style={[styles.backupDangerButton, (creatingBackup || restoringBackup) && styles.importButtonDisabled]}
            onPress={handlePickRestoreBackup}
            disabled={creatingBackup || restoringBackup}
          >
            {restoringBackup ? (
              <ActivityIndicator size="small" color={colors.danger} />
            ) : (
              <Text style={styles.backupDangerText}>从备份恢复</Text>
            )}
          </Pressable>
        </View>
        <Pressable
          style={styles.diagnosticsButton}
          onPress={() => router.push('/chat-diagnostics')}
        >
          <Text style={styles.diagnosticsButtonText}>打开聊天数据库诊断</Text>
        </Pressable>
        <Pressable
          style={styles.diagnosticsButton}
          onPress={() => router.push('/api-usage')}
        >
          <Text style={styles.diagnosticsButtonText}>打开 API 使用日志</Text>
        </Pressable>
        <Pressable
          style={styles.diagnosticsButton}
          onPress={() => router.push('/api-achievements')}
        >
          <Text style={styles.diagnosticsButtonText}>打开 API 成就徽章</Text>
        </Pressable>
      </View>

      {/* Model picker modal */}
      <Modal visible={showModelPicker} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => setShowModelPicker(false)}>
          <View style={styles.modal} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>
              {modelPickerTarget === 'image' ? '选择生图模型' : '选择聊天模型'}
            </Text>
            <FlatList
              data={models}
              keyExtractor={(item) => item}
              style={styles.modelList}
              renderItem={({ item }) => (
                <Pressable
                  style={[
                    styles.modelItem,
                    item === (modelPickerTarget === 'image' ? imageModel : model) && styles.modelItemActive,
                  ]}
                  onPress={() => handleSelectModel(item)}
                >
                  <Text
                    style={[
                      styles.modelItemText,
                      item === (modelPickerTarget === 'image' ? imageModel : model) && styles.modelItemTextActive,
                    ]}
                  >
                    {item}
                  </Text>
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>
      <Modal visible={showImageOptionPicker !== null} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => setShowImageOptionPicker(null)}>
          <View style={styles.modal} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>
              {showImageOptionPicker === 'quality' ? '选择图片质量' : '选择图片尺寸'}
            </Text>
            {(showImageOptionPicker === 'quality' ? IMAGE_QUALITY_OPTIONS : IMAGE_SIZE_OPTIONS).map((item) => {
              const active = item === (showImageOptionPicker === 'quality' ? imageQuality : imageSize);
              return (
                <Pressable
                  key={item}
                  style={[styles.modelItem, active && styles.modelItemActive]}
                  onPress={() => handleSelectImageOption(item)}
                >
                  <Text style={[styles.modelItemText, active && styles.modelItemTextActive]}>{item}</Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}
