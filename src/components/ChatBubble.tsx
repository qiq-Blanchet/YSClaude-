import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Image, Alert, TextInput, Modal, Dimensions } from 'react-native';
import Markdown from '@ronradtke/react-native-markdown-display';
import { Message } from '../types';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';
import { useChatStore } from '../stores/chat';
import { useSettingsStore } from '../stores/settings';
import { playTTS, stopTTS } from '../services/tts';

const chatIcons = [
  require('../../assets/chat1.png'),
  require('../../assets/chat2.png'),
  require('../../assets/chat3.png'),
  require('../../assets/chat4.png'),
  require('../../assets/chat5.png'),
  require('../../assets/chat6.png'),
];

interface Props {
  message: Message;
  isLastAssistant?: boolean;
  isHidden?: boolean;
}

// 工具名 → 中文动作描述
const TOOL_LABELS: Record<string, string> = {
  search_memory_vault: '搜索记忆库',
  query_diary: '查询日记',
  web_search: '联网搜索',
};

// 把一次工具调用格式化成「动作描述 + 参数」的单行文字。
// 参数取第一个有意义的字段（query/date 等），解析失败时仅显示动作描述。
function formatToolInvocation(name: string, rawArgs: string): string {
  const label = TOOL_LABELS[name] || name;
  let detail = '';
  try {
    const args = JSON.parse(rawArgs || '{}');
    detail = args.query ?? args.date ?? '';
    if (detail && typeof detail !== 'string') detail = String(detail);
  } catch {
    detail = '';
  }
  return detail ? `${label}：${detail}` : label;
}

// 思维链胶囊：白底灰边圆角，左侧 clock 图标 + "Thought process"，点击展开/收起内容。
function ThinkingBlock({ thinking }: { thinking: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.thinkingWrap}>
      <Pressable style={styles.thinkingPill} onPress={() => setExpanded((v) => !v)}>
        <Image
          source={require('../../assets/clock.png')}
          style={styles.thinkingIcon}
          resizeMode="contain"
        />
        <Text style={styles.thinkingLabel}>Thought process</Text>
      </Pressable>
      {expanded && (
        <View style={styles.thinkingContent}>
          <Markdown style={thinkingMarkdownStyles}>{thinking}</Markdown>
        </View>
      )}
    </View>
  );
}

// 从 AI 输出中拆出思维链与剩余正文。
// 只处理「第一个」<thinking>，之后正文里再出现的 <thinking> 标签原样保留，
// 避免正文中出现的标签被误当成思维链而吞掉后续文字。
function splitThinking(raw: string): { thinking: string; body: string } {
  if (!raw) return { thinking: '', body: '' };
  const openIdx = raw.search(/<thinking>/i);
  if (openIdx === -1) return { thinking: '', body: raw.trim() };

  const afterOpen = raw.slice(openIdx).replace(/<thinking>/i, '');
  const closeMatch = afterOpen.match(/<\/thinking>/i);

  let thinking: string;
  let body: string;
  if (closeMatch && closeMatch.index !== undefined) {
    // 已闭合：思维链取首个标签对内部，正文为标签前 + 标签后（含其中可能的其它 <thinking>）
    thinking = afterOpen.slice(0, closeMatch.index);
    const tail = afterOpen.slice(closeMatch.index + closeMatch[0].length);
    body = raw.slice(0, openIdx) + tail;
  } else {
    // 流式中尚未闭合：剩余全部视为思维链，正文为标签前部分
    thinking = afterOpen;
    body = raw.slice(0, openIdx);
  }
  return { thinking: thinking.trim(), body: body.trim() };
}

export function ChatBubble({ message, isLastAssistant, isHidden }: Props) {
  const isUser = message.role === 'user';
  const { messages, editMessage, removeMessage, regenerate } = useChatStore();
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editText, setEditText] = useState('');
  // 当前编辑目标消息的 id
  const [editTargetId, setEditTargetId] = useState<string | null>(null);
  // 用户气泡长按浮出的操作菜单是否显示
  const [menuVisible, setMenuVisible] = useState(false);
  // 长按时测量得到的气泡屏幕坐标，用于把菜单锚定到气泡上方
  const [menuAnchor, setMenuAnchor] = useState({ x: 0, y: 0, width: 0 });
  const bubbleRef = useRef<View>(null);

  function handleUserLongPress() {
    // 测量气泡在屏幕中的位置，再据此定位菜单
    bubbleRef.current?.measureInWindow((x, y, width) => {
      setMenuAnchor({ x, y, width });
      setMenuVisible(true);
    });
  }

  function openUserEdit() {
    setMenuVisible(false);
    setEditTargetId(message.id);
    setEditText(message.content);
    setEditModalVisible(true);
  }

  function deleteUserMessage() {
    setMenuVisible(false);
    removeMessage(message.id);
  }

  // 编辑弹窗（两个分支共用）
  const editModal = (
    <Modal visible={editModalVisible} transparent animationType="fade">
      <Pressable style={styles.overlay} onPress={() => setEditModalVisible(false)}>
        <View style={styles.modal} onStartShouldSetResponder={() => true}>
          <Text style={styles.modalTitle}>
            {editTargetId === message.id && !isUser ? '编辑 AI 消息' : '编辑用户消息'}
          </Text>
          <TextInput
            style={styles.modalInput}
            value={editText}
            onChangeText={setEditText}
            multiline
            autoFocus
          />
          <View style={styles.modalButtons}>
            <Pressable style={styles.modalCancel} onPress={() => setEditModalVisible(false)}>
              <Text style={styles.modalCancelText}>取消</Text>
            </Pressable>
            <Pressable style={styles.modalConfirm} onPress={handleSaveEdit}>
              <Text style={styles.modalConfirmText}>保存</Text>
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Modal>
  );

  if (isUser) {
    // 菜单宽度估算，用于让菜单右对齐气泡右缘
    const MENU_WIDTH = 140;
    const MENU_HEIGHT = 44;
    const menuLeft = Math.max(8, menuAnchor.x + menuAnchor.width - MENU_WIDTH);
    const menuTop = Math.max(8, menuAnchor.y - MENU_HEIGHT - 8);

    return (
      <View style={[styles.userRow, isHidden && styles.hiddenRow]}>
        <View style={styles.userColumn}>
          {isHidden && <Text style={styles.hiddenLabelRight}>已隐藏</Text>}
          <Pressable
            ref={bubbleRef}
            onLongPress={handleUserLongPress}
            style={styles.userBubble}
          >
            <Text style={styles.userText}>{message.content}</Text>
          </Pressable>
        </View>

        {/* 长按操作菜单：用 Modal 渲染，全屏透明层捕获外部点击关闭，
            菜单按测量到的气泡坐标锚定在气泡正上方。 */}
        <Modal transparent visible={menuVisible} animationType="fade" onRequestClose={() => setMenuVisible(false)}>
          <Pressable style={styles.menuDismissOverlay} onPress={() => setMenuVisible(false)}>
            <View style={[styles.bubbleMenu, { left: menuLeft, top: menuTop }]}>
              <Pressable style={styles.bubbleMenuItem} onPress={openUserEdit}>
                <Text style={styles.bubbleMenuText}>编辑</Text>
              </Pressable>
              <View style={styles.bubbleMenuDivider} />
              <Pressable style={styles.bubbleMenuItem} onPress={deleteUserMessage}>
                <Text style={[styles.bubbleMenuText, styles.bubbleMenuTextDanger]}>删除</Text>
              </Pressable>
            </View>
          </Pressable>
        </Modal>

        {editModal}
      </View>
    );
  }

  const userMsgBefore = (() => {
    const idx = messages.findIndex((m) => m.id === message.id);
    if (idx > 0 && messages[idx - 1].role === 'user') return messages[idx - 1];
    return null;
  })();

  // 拆分思维链与正文：<thinking> 内容进胶囊，正文只渲染剩余部分
  const { thinking, body } = splitThinking(message.content);

  function handleAction(index: number) {
    switch (index) {
      case 0: // 编辑 AI 消息
        setEditTargetId(message.id);
        setEditText(message.content);
        setEditModalVisible(true);
        break;
      case 1: // 删除 AI 消息
        Alert.alert('删除', '确定删除该 AI 消息？', [
          { text: '取消', style: 'cancel' },
          { text: '删除', style: 'destructive', onPress: () => removeMessage(message.id) },
        ]);
        break;
      case 2: // TTS 播放
        const ttsConfig = useSettingsStore.getState().ttsConfig;
        if (!ttsConfig.apiKey || !ttsConfig.groupId) {
          Alert.alert('提示', '请先在设置 > TTS 配置中填写 Group ID 和 API Key');
        } else {
          playTTS(message.content, ttsConfig).catch((e) =>
            Alert.alert('TTS 失败', e.message)
          );
        }
        break;
      case 3: // 编辑用户消息
        if (userMsgBefore) {
          setEditTargetId(userMsgBefore.id);
          setEditText(userMsgBefore.content);
          setEditModalVisible(true);
        }
        break;
      case 4: // 删除用户消息
        if (userMsgBefore) {
          Alert.alert('删除', '确定删除该用户消息？', [
            { text: '取消', style: 'cancel' },
            { text: '删除', style: 'destructive', onPress: () => removeMessage(userMsgBefore.id) },
          ]);
        }
        break;
      case 5: // 重新生成
        if (isLastAssistant) regenerate();
        break;
    }
  }

  function handleSaveEdit() {
    if (editTargetId && editText.trim()) {
      editMessage(editTargetId, editText.trim());
    }
    setEditModalVisible(false);
    setEditTargetId(null);
  }

  return (
    <View style={[styles.assistantRow, isHidden && styles.hiddenBubble]}>
      {isHidden && <Text style={styles.hiddenLabelLeft}>已隐藏</Text>}
      {/* 工具调用记录：显示在 AI 回复文字上方，每次调用一行 */}
      {message.toolInvocations && message.toolInvocations.length > 0 && (
        <View style={styles.toolList}>
          {message.toolInvocations.map((inv, i) => (
            <View key={i} style={styles.toolRow}>
              <Image
                source={require('../../assets/clock.png')}
                style={styles.toolIconLeft}
                resizeMode="contain"
              />
              <Text style={styles.toolText} numberOfLines={1}>
                {formatToolInvocation(inv.name, inv.args)}
              </Text>
              <Image
                source={require('../../assets/rightarrow.png')}
                style={styles.toolIconRight}
                resizeMode="contain"
              />
            </View>
          ))}
        </View>
      )}
      {/* 思维链：<thinking> 包裹的内容拆出，正文只渲染剩余部分 */}
      {thinking.length > 0 && <ThinkingBlock thinking={thinking} />}
      <View style={styles.assistantContent}>
        <Markdown style={markdownStyles}>{body || ' '}</Markdown>
      </View>
      {message.content.length > 0 && (
        <>
          <View style={styles.actions}>
            {chatIcons.map((icon, i) => (
              <Pressable key={i} style={styles.actionButton} onPress={() => handleAction(i)}>
                <Image source={icon} style={styles.actionImage} resizeMode="contain" />
              </Pressable>
            ))}
          </View>
          <View style={styles.logoRow}>
            <Image source={require('../../assets/claudelogo.png')} style={styles.logoImage} resizeMode="contain" />
            <Text style={styles.disclaimerText}>
              Claude is AI and can make mistakes.{'\n'}Please double-check responses.
            </Text>
          </View>
        </>
      )}

      {editModal}
    </View>
  );
}

const styles = StyleSheet.create({
  userRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    marginVertical: 8,
  },
  // 用户气泡列：让「已隐藏」标签右对齐于气泡上方
  userColumn: {
    alignItems: 'flex-end',
    maxWidth: '75%',
  },
  // 已隐藏楼层：整体降低透明度作区分
  hiddenRow: {
    opacity: 0.4,
  },
  hiddenBubble: {
    opacity: 0.4,
  },
  hiddenLabelRight: {
    fontSize: 10,
    color: colors.textTertiary,
    marginBottom: 3,
    textAlign: 'right',
  },
  hiddenLabelLeft: {
    fontSize: 10,
    color: colors.textTertiary,
    marginBottom: 3,
    textAlign: 'left',
  },
  // 长按菜单：全屏透明关闭层 + 锚定气泡上方的菜单
  menuDismissOverlay: {
    flex: 1,
  },
  bubbleMenu: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 4,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  bubbleMenuItem: {
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  bubbleMenuText: {
    fontSize: 15,
    color: colors.text,
    fontWeight: '500',
  },
  bubbleMenuTextDanger: {
    color: colors.danger,
  },
  bubbleMenuDivider: {
    width: StyleSheet.hairlineWidth,
    height: 20,
    backgroundColor: colors.inputBorder,
  },
  userBubble: {
    backgroundColor: colors.userBubble,
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  userText: {
    fontSize: 16,
    color: colors.text,
    lineHeight: 22,
    fontFamily: fonts.serif,
  },
  assistantRow: {
    paddingHorizontal: 16,
    marginVertical: 8,
  },
  assistantContent: {
    maxWidth: '100%',
  },
  // 工具调用记录列表（位于回复文字上方）
  toolList: {
    marginBottom: 8,
    gap: 6,
  },
  // 单行工具调用：左图标 + 中间文字 + 右箭头，左对齐
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toolIconLeft: {
    width: 13,
    height: 13,
    marginRight: 8,
  },
  toolText: {
    flexShrink: 1,
    fontSize: 13,
    color: colors.textSecondary,
  },
  toolIconRight: {
    width: 11,
    height: 11,
    marginLeft: 4,
  },
  // 思维链：胶囊 + 展开内容
  thinkingWrap: {
    marginBottom: 10,
    alignItems: 'flex-start',
  },
  // 白底灰边圆角胶囊，左侧 clock 图标 + 文字
  thinkingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  thinkingIcon: {
    width: 14,
    height: 14,
    marginRight: 7,
  },
  thinkingLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  // 展开后的思维链内容容器
  thinkingContent: {
    marginTop: 6,
    paddingLeft: 4,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  actions: {
    flexDirection: 'row',
    marginTop: -4,
    gap: 2,
  },
  actionButton: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 6,
  },
  actionImage: {
    width: 16,
    height: 16,
  },
  logoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  logoImage: {
    width: 28,
    height: 28,
  },
  disclaimerText: {
    fontSize: 11,
    color: colors.textTertiary,
    textAlign: 'right',
    lineHeight: 16,
  },
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center', alignItems: 'center',
  },
  modal: {
    backgroundColor: colors.background, borderRadius: 16, padding: 24, width: '85%',
  },
  modalTitle: {
    fontSize: 17, fontWeight: '600', color: colors.text, marginBottom: 16,
  },
  modalInput: {
    backgroundColor: colors.inputBackground, borderWidth: 1, borderColor: colors.inputBorder,
    borderRadius: 10, padding: 12, fontSize: 15, color: colors.text,
    minHeight: 100, maxHeight: 240, textAlignVertical: 'top', marginBottom: 20,
  },
  modalButtons: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: 12,
  },
  modalCancel: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  modalCancelText: { fontSize: 15, color: colors.textSecondary },
  modalConfirm: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.primary,
  },
  modalConfirmText: { fontSize: 15, color: '#FFFFFF', fontWeight: '500' },
});

const thinkingMarkdownStyles = StyleSheet.create({
  body: { fontSize: 14, color: colors.textSecondary, lineHeight: 21 },
  code_inline: {
    backgroundColor: colors.surface, color: colors.primary,
    paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, fontSize: 13, fontFamily: 'monospace',
  },
  fence: { backgroundColor: colors.codeBlock, borderRadius: 10, padding: 12, marginVertical: 8 },
  code_block: { color: colors.codeText, fontSize: 12, fontFamily: 'monospace' },
  link: { color: colors.primary },
});

const markdownStyles = StyleSheet.create({
  body: { fontSize: 16, color: colors.text, lineHeight: 24, fontFamily: fonts.serif },
  code_inline: {
    backgroundColor: colors.surface, color: colors.primary,
    paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, fontSize: 14, fontFamily: 'monospace',
  },
  fence: { backgroundColor: colors.codeBlock, borderRadius: 10, padding: 14, marginVertical: 10 },
  code_block: { color: colors.codeText, fontSize: 13, fontFamily: 'monospace' },
  heading1: { fontSize: 22, fontFamily: fonts.serifBold, marginVertical: 8, color: colors.text },
  heading2: { fontSize: 18, fontFamily: fonts.serifBold, marginVertical: 6, color: colors.text },
  heading3: { fontSize: 16, fontFamily: fonts.serifBold, marginVertical: 4, color: colors.text },
  strong: { fontFamily: fonts.serifBold },
  blockquote: {
    borderLeftWidth: 3, borderLeftColor: colors.primary, paddingLeft: 12, marginVertical: 8, opacity: 0.8,
  },
  list_item: { marginVertical: 2 },
  link: { color: colors.primary },
});
