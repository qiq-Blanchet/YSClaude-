import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSettingsPageColors } from '../../theme/colors';
import { useSettingsStore } from '../../stores/settings';
import { useChatStore } from '../../stores/chat';
import { useDiaryStore } from '../../stores/diary';
import { streamChat } from '../../services/api';
import { getFavoriteDiaries } from '../../db/operations';
import { uploadDiary } from '../../services/tools';
import { formatDateOnly, formatFullTime } from '../../utils/time';
import { type Diary } from '../../types';
import { createSettingsStyles } from './styles';

type SettingsTabProps = {
  showToast: (message: string) => void;
  keyboardBottomInset: number;
};

export function DiaryTab({ showToast, keyboardBottomInset }: SettingsTabProps) {
  const colors = useSettingsPageColors();
  const styles = useMemo(() => createSettingsStyles(colors), [colors]);
  const { diaries, loadDiaries, addDiary, editDiary, toggleFavorite, removeDiary } = useDiaryStore();
  // 隐藏楼层随对话独立，与待总结的消息同源，统一从 chat store 取
  const { messages, hiddenRanges } = useChatStore();
  const { apiConfigs, activeConfigIndex, systemPrompt, maxOutputTokens, memoryVaultConfig } = useSettingsStore();

  // AI 总结相关 state
  const [fromStr, setFromStr] = useState('');
  const [toStr, setToStr] = useState('');
  const [summarizing, setSummarizing] = useState(false);
  const [summaryText, setSummaryText] = useState('');
  const [summaryTitle, setSummaryTitle] = useState('');
  const summaryAbort = useRef<AbortController | null>(null);

  // 编辑日记 Modal state
  const [editing, setEditing] = useState<Diary | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');

  // 新建日记 Modal state
  const [creating, setCreating] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createContent, setCreateContent] = useState('');

  // 上传到云端记忆库 Modal state
  const [uploadTarget, setUploadTarget] = useState<Diary | null>(null);
  const [uploadDate, setUploadDate] = useState('');
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    loadDiaries();
  }, []);

  async function handleSummarize() {
    const config = apiConfigs[activeConfigIndex];
    if (!config || !config.baseUrl || !config.apiKey) {
      Alert.alert('提示', '请先在设置中配置 API');
      return;
    }

    // 取当前对话的 user/assistant 消息
    const chatMessages = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
    if (chatMessages.length === 0) {
      Alert.alert('提示', '当前对话没有可总结的消息');
      return;
    }

    const total = chatMessages.length;
    let from = parseInt(fromStr, 10);
    let to = parseInt(toStr, 10);
    if (isNaN(from)) from = 1;
    if (isNaN(to)) to = total;
    if (from < 1) from = 1;
    if (to > total) to = total;
    if (from > to) {
      Alert.alert('提示', '请输入有效的范围（起始 ≤ 结束）');
      return;
    }

    // 按 1-based index 取范围内、且未被隐藏的消息
    const selected = chatMessages.filter((_, index) => {
      const msgNum = index + 1;
      if (msgNum < from || msgNum > to) return false;
      const hidden = hiddenRanges.some((r) => msgNum >= r.from && msgNum <= r.to);
      return !hidden;
    });

    if (selected.length === 0) {
      Alert.alert('提示', '所选范围内没有未隐藏的消息');
      return;
    }

    // 拼接对话内容
    const conversationText = selected
      .map((m) => `${m.role === 'user' ? '用户' : '我'}：${m.content}`)
      .join('\n\n');

    // 已收藏日记作为近期日记
    const favorites = await getFavoriteDiaries();
    const memoryMessages: { role: string; content: string }[] = [];
    if (favorites.length > 0) {
      const memoryContent = favorites
        .map((d) => `${d.title}\n${d.content}`)
        .join('\n\n---\n\n');
      memoryMessages.push({ role: 'system', content: `以下是你的近期日记：\n\n${memoryContent}` });
    }

    const summaryPrompt =
      '请你以第一人称、流水账的形式，把下面这段对话总结成一篇今天的日记。' +
      '只输出日记正文，不要加任何额外说明或标题。';

    setSummarizing(true);
    setSummaryText('');
    summaryAbort.current = new AbortController();

    try {
      await streamChat(
        {
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          model: config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...memoryMessages,
            { role: 'user', content: `${summaryPrompt}\n\n以下是对话内容：\n\n${conversationText}` },
          ],
          maxTokens: maxOutputTokens || undefined,
          temperature: config.temperature,
        },
        (token: string) => setSummaryText((prev) => prev + token),
        summaryAbort.current.signal
      );
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        Alert.alert('总结失败', e.message || '请求失败');
      }
    } finally {
      setSummarizing(false);
      summaryAbort.current = null;
    }
  }

  function handleStopSummarize() {
    summaryAbort.current?.abort();
    setSummarizing(false);
  }

  async function handleSaveSummary() {
    const content = summaryText.trim();
    if (!content) {
      Alert.alert('提示', '没有可保存的内容');
      return;
    }
    const title = summaryTitle.trim() || `日记 ${formatFullTime(Date.now())}`;
    await addDiary(title, content);
    setSummaryText('');
    setSummaryTitle('');
    setFromStr('');
    setToStr('');
    showToast('日记已保存');
  }

  function handleOpenCreate() {
    setCreateTitle('');
    setCreateContent('');
    setCreating(true);
  }

  async function handleSaveCreate() {
    const content = createContent.trim();
    const title = createTitle.trim();
    if (!content && !title) {
      Alert.alert('提示', '请输入日记内容');
      return;
    }
    await addDiary(title || `日记 ${formatFullTime(Date.now())}`, content);
    setCreating(false);
    setCreateTitle('');
    setCreateContent('');
  }

  function handleOpenUpload(d: Diary) {
    setUploadTarget(d);
    setUploadDate(formatDateOnly(d.createdAt));
  }

  async function handleConfirmUpload() {
    if (!uploadTarget) return;
    const date = uploadDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      Alert.alert('提示', '请输入正确的日期格式：YYYY-MM-DD');
      return;
    }
    // 标题并入正文：标题\n正文
    const title = uploadTarget.title.trim();
    const body = uploadTarget.content.trim();
    const content = title ? `${title}\n${body}` : body;
    if (!content) {
      Alert.alert('提示', '该日记内容为空，无法上传');
      return;
    }
    setUploading(true);
    try {
      await uploadDiary(date, content, memoryVaultConfig);
      setUploadTarget(null);
      Alert.alert('上传成功', `日记已上传到云端记忆库（${date}）`);
    } catch (e: any) {
      Alert.alert('上传失败', e.message || '请求失败');
    } finally {
      setUploading(false);
    }
  }

  function handleOpenEdit(d: Diary) {
    setEditing(d);
    setEditTitle(d.title);
    setEditContent(d.content);
  }

  async function handleSaveEdit() {
    if (!editing) return;
    await editDiary(editing.id, { title: editTitle.trim(), content: editContent.trim() });
    setEditing(null);
  }

  function handleDeleteDiary(d: Diary) {
    Alert.alert('删除日记', `确定删除「${d.title || '无标题'}」？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => removeDiary(d.id) },
    ]);
  }

  return (
    <ScrollView
      style={styles.content}
      contentContainerStyle={{ paddingBottom: keyboardBottomInset + 20 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* AI 日记总结 */}
      <Text style={styles.sectionTitle}>AI 日记总结</Text>
      <Text style={styles.hint}>选择消息范围，让 AI 以第一人称流水账总结为日记（自动排除已隐藏消息，留空则全部）</Text>

      <View style={styles.rangeInputRow}>
        <Text style={styles.rangeLabel}>从第</Text>
        <TextInput style={styles.rangeInput} value={fromStr} onChangeText={setFromStr}
          keyboardType="number-pad" placeholder="1" placeholderTextColor={colors.textTertiary} />
        <Text style={styles.rangeLabel}>条到第</Text>
        <TextInput style={styles.rangeInput} value={toStr} onChangeText={setToStr}
          keyboardType="number-pad" placeholder="末" placeholderTextColor={colors.textTertiary} />
        <Text style={styles.rangeLabel}>条</Text>
        {summarizing ? (
          <Pressable style={styles.rangeAddButton} onPress={handleStopSummarize}>
            <Text style={styles.rangeAddText}>停止</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.rangeAddButton} onPress={handleSummarize}>
            <Text style={styles.rangeAddText}>总结</Text>
          </Pressable>
        )}
      </View>

      {(summaryText.length > 0 || summarizing) && (
        <View style={styles.summaryBox}>
          <TextInput
            style={styles.summaryTitleInput}
            value={summaryTitle}
            onChangeText={setSummaryTitle}
            placeholder="日记标题（留空自动生成）"
            placeholderTextColor={colors.textTertiary}
          />
          <TextInput
            style={styles.summaryContentInput}
            value={summaryText}
            onChangeText={setSummaryText}
            multiline
            scrollEnabled
            placeholder="AI 总结内容将显示在这里..."
            placeholderTextColor={colors.textTertiary}
          />
          {summarizing ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />
          ) : (
            <Pressable style={styles.saveButton} onPress={handleSaveSummary}>
              <Text style={styles.saveButtonText}>保存为日记</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* 我的日记 */}
      <View style={styles.diaryHeaderRow}>
        <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>我的日记</Text>
        <Pressable style={styles.diaryAddButton} onPress={handleOpenCreate}>
          <Text style={styles.diaryAddText}>+ 新建</Text>
        </Pressable>
      </View>
      {diaries.length === 0 ? (
        <Text style={styles.hint}>暂无日记</Text>
      ) : (
        diaries.map((d) => (
          <Pressable
            key={d.id}
            style={styles.diaryItem}
            onPress={() => handleOpenEdit(d)}
            onLongPress={() => handleDeleteDiary(d)}
          >
            <Pressable style={styles.diaryStar} onPress={() => toggleFavorite(d.id)} hitSlop={8}>
              <Text style={[styles.diaryStarText, d.isFavorite && styles.diaryStarActive]}>
                {d.isFavorite ? '★' : '☆'}
              </Text>
            </Pressable>
            <View style={styles.diaryContent}>
              <Text style={styles.diaryTitle} numberOfLines={1}>{d.title || '无标题'}</Text>
              <Text style={styles.diaryPreview} numberOfLines={1}>{d.content}</Text>
              <Text style={styles.diaryDate}>{formatFullTime(d.createdAt)}</Text>
            </View>
            <Pressable style={styles.diaryUpload} onPress={() => handleOpenUpload(d)} hitSlop={8}>
              <Text style={styles.diaryUploadText}>上传</Text>
            </Pressable>
          </Pressable>
        ))
      )}

      <View style={{ height: 40 }} />

      {/* 编辑日记 Modal */}
      <Modal visible={!!editing} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => setEditing(null)}>
          <View style={styles.modal} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>编辑日记</Text>
            <TextInput
              style={styles.summaryTitleInput}
              value={editTitle}
              onChangeText={setEditTitle}
              placeholder="日记标题"
              placeholderTextColor={colors.textTertiary}
            />
            <TextInput
              style={[styles.summaryContentInput, styles.diaryModalContentInput]}
              value={editContent}
              onChangeText={setEditContent}
              multiline
              scrollEnabled
              placeholder="日记内容"
              placeholderTextColor={colors.textTertiary}
            />
            <View style={styles.modalButtons}>
              <Pressable style={styles.modalCancel} onPress={() => setEditing(null)}>
                <Text style={styles.modalCancelText}>取消</Text>
              </Pressable>
              <Pressable style={styles.modalConfirm} onPress={handleSaveEdit}>
                <Text style={styles.modalConfirmText}>保存</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* 新建日记 Modal */}
      <Modal visible={creating} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => setCreating(false)}>
          <View style={styles.modal} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>新建日记</Text>
            <TextInput
              style={styles.summaryTitleInput}
              value={createTitle}
              onChangeText={setCreateTitle}
              placeholder="日记标题（留空自动生成）"
              placeholderTextColor={colors.textTertiary}
            />
            <TextInput
              style={[styles.summaryContentInput, styles.diaryModalContentInput]}
              value={createContent}
              onChangeText={setCreateContent}
              multiline
              scrollEnabled
              placeholder="日记内容"
              placeholderTextColor={colors.textTertiary}
            />
            <View style={styles.modalButtons}>
              <Pressable style={styles.modalCancel} onPress={() => setCreating(false)}>
                <Text style={styles.modalCancelText}>取消</Text>
              </Pressable>
              <Pressable style={styles.modalConfirm} onPress={handleSaveCreate}>
                <Text style={styles.modalConfirmText}>保存</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* 上传日记到云端 Modal */}
      <Modal visible={!!uploadTarget} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => !uploading && setUploadTarget(null)}>
          <View style={styles.modal} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>上传到云端记忆库</Text>
            <Text style={styles.hint}>标题将并入正文上传。请确认日期（一个日期对应一篇云端日记，重复日期可能覆盖）</Text>
            <TextInput
              style={styles.summaryTitleInput}
              value={uploadDate}
              onChangeText={setUploadDate}
              placeholder="日期 YYYY-MM-DD"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
            />
            <View style={styles.modalButtons}>
              <Pressable style={styles.modalCancel} onPress={() => !uploading && setUploadTarget(null)}>
                <Text style={styles.modalCancelText}>取消</Text>
              </Pressable>
              <Pressable style={styles.modalConfirm} onPress={handleConfirmUpload} disabled={uploading}>
                {uploading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalConfirmText}>上传</Text>
                )}
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}
