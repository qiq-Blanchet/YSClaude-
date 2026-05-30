import React, { useRef, useEffect, useState, useMemo } from 'react';
import { View, FlatList, Text, Pressable, StyleSheet, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useKeyboardHeight } from '../src/hooks/useKeyboardHeight';
import { colors } from '../src/theme/colors';
import { fonts } from '../src/theme/fonts';
import { useChatStore } from '../src/stores/chat';
import { ChatBubble } from '../src/components/ChatBubble';
import { ChatInput } from '../src/components/ChatInput';
import { ModelSelector } from '../src/components/ModelSelector';
import { TimeDivider } from '../src/components/TimeDivider';
import { Message } from '../src/types';
import { TIME_GAP_THRESHOLD_MS } from '../src/utils/time';

export default function ChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const { messages, hiddenRanges, isStreaming, error, addUserMessage, triggerResponse, stopStreaming } = useChatStore();
  const [showModelSelector, setShowModelSelector] = useState(false);
  const flatListRef = useRef<FlatList<Message>>(null);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

  // 消息ID → 楼层号（仅 user/assistant，1-based），与 API 过滤/隐藏设置的编号口径一致
  const floorMap = useMemo(() => {
    const map = new Map<string, number>();
    let floor = 0;
    for (const msg of messages) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        floor++;
        map.set(msg.id, floor);
      }
    }
    return map;
  }, [messages]);

  // 所有被隐藏的楼层号集合，渲染时 O(1) 判断
  const hiddenFloorSet = useMemo(() => {
    const set = new Set<number>();
    for (const r of hiddenRanges) {
      for (let i = r.from; i <= r.to; i++) set.add(i);
    }
    return set;
  }, [hiddenRanges]);

  // 页面主体内容。iOS 与 Android 共用，区别只在外层是否包 KeyboardAvoidingView。
  const content = (
    <>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.headerButton} onPress={() => router.push('/history')}>
          <View style={styles.hamburgerLines}>
            <View style={styles.hamburgerLine} />
            <View style={styles.hamburgerLine} />
            <View style={[styles.hamburgerLine, styles.hamburgerLineShort]} />
          </View>
        </Pressable>
        <Pressable style={styles.headerButton} onPress={() => router.push('/settings')}>
          <Image source={require('../assets/setting.png')} style={styles.settingIcon} resizeMode="contain" />
        </Pressable>
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => {
          // 与上一条消息间隔超过阈值时，在该消息上方插入居中时间分隔
          const prev = index > 0 ? messages[index - 1] : null;
          const showDivider =
            !prev || item.createdAt - prev.createdAt >= TIME_GAP_THRESHOLD_MS;
          // 该消息对应的楼层号若落在隐藏区间内，则在界面上做淡化区分
          const floor = floorMap.get(item.id);
          const isHidden = floor !== undefined && hiddenFloorSet.has(floor);
          return (
            <>
              {showDivider && <TimeDivider timestamp={item.createdAt} />}
              <ChatBubble
                message={item}
                isHidden={isHidden}
                isLastAssistant={
                  item.role === 'assistant' &&
                  index === messages.length - 1
                }
              />
            </>
          );
        }}
        style={styles.messageList}
        contentContainerStyle={styles.messageContent}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={<EmptyState />}
      />

      {/* Input */}
      <ChatInput
        onSend={addUserMessage}
        onTriggerResponse={triggerResponse}
        disabled={isStreaming}
        isStreaming={isStreaming}
        onStop={stopStreaming}
        onModelPress={() => setShowModelSelector(true)}
      />

      {showModelSelector && (
        <ModelSelector onClose={() => setShowModelSelector(false)} />
      )}
    </>
  );

  // SDK 54+ 起 Android 强制开启 edge-to-edge：窗口绘制到键盘后面，
  // adjustResize 不再缩小 RN 根视图，KeyboardAvoidingView 也常拿不到正确的
  // 键盘高度 —— 所以输入框不被顶起。改为直接监听 Keyboard 事件，自己给容器
  // 底部加 paddingBottom 把内容顶上去，最可靠、零原生改动。
  //
  // keyboardHeight 是从窗口底部算起的完整高度（edge-to-edge 下含手势条区域）。
  // ChatInput 自身已经垫了 insets.bottom 的底部安全区，键盘弹起时这块被键盘
  // 盖住，所以容器只需顶起「键盘高度 - 底部安全区」，避免顶过头。
  const liftHeight = keyboardHeight > 0 ? Math.max(keyboardHeight - insets.bottom, 0) : 0;

  return (
    <View style={[styles.container, { paddingBottom: liftHeight }]}>
      {content}
    </View>
  );
}

function EmptyState() {
  return (
    <View style={styles.emptyContainer}>
      <Image source={require('../assets/claudelogo.png')} style={styles.emptyLogo} resizeMode="contain" />
      <Text style={styles.emptyText}>有什么我可以帮你的吗？</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 48,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  headerButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  hamburgerLines: {
    width: 20,
    height: 16,
    justifyContent: 'space-between',
  },
  hamburgerLine: {
    width: 18,
    height: 2,
    backgroundColor: colors.text,
    borderRadius: 1,
  },
  hamburgerLineShort: {
    width: 9,
  },
  settingIcon: {
    width: 22,
    height: 22,
  },
  errorBanner: {
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginHorizontal: 16,
    borderRadius: 8,
  },
  errorText: {
    fontSize: 13,
    color: colors.danger,
  },
  messageList: {
    flex: 1,
  },
  messageContent: {
    paddingVertical: 8,
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 120,
  },
  emptyLogo: {
    width: 64,
    height: 64,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 18,
    color: colors.textSecondary,
  },
});
