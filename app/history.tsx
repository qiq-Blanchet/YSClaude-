import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, Alert, TextInput, Modal } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { colors } from '../src/theme/colors';
import { fonts } from '../src/theme/fonts';
import { Conversation } from '../src/types';
import { getAllConversations, deleteConversation, updateConversation } from '../src/db/operations';
import { useChatStore } from '../src/stores/chat';

export default function HistoryScreen() {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [editingConv, setEditingConv] = useState<Conversation | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const { loadConversation, newConversation } = useChatStore();

  useFocusEffect(
    useCallback(() => {
      loadList();
    }, [])
  );

  async function loadList() {
    const list = await getAllConversations();
    setConversations(list);
  }

  function handleOpen(conv: Conversation) {
    loadConversation(conv.id);
    router.back();
  }

  function handleLongPress(conv: Conversation) {
    setEditingConv(conv);
    setEditTitle(conv.title);
  }

  async function handleSaveTitle() {
    if (!editingConv) return;
    await updateConversation(editingConv.id, { title: editTitle.trim(), updatedAt: Date.now() });
    setEditingConv(null);
    loadList();
  }

  function handleDelete(conv: Conversation) {
    Alert.alert('删除对话', `确定删除「${conv.title || '无标题'}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await deleteConversation(conv.id);
          loadList();
        },
      },
    ]);
  }

  function handleNewChat() {
    newConversation();
    router.back();
  }

  function formatTime(ts: number) {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backIcon}>←</Text>
        </Pressable>
        <Text style={styles.title}>对话历史</Text>
        <Pressable style={styles.newButton} onPress={handleNewChat}>
          <Text style={styles.newIcon}>✎</Text>
        </Pressable>
      </View>

      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            style={styles.item}
            onPress={() => handleOpen(item)}
            onLongPress={() => handleLongPress(item)}
          >
            <View style={styles.itemContent}>
              <Text style={styles.itemTitle} numberOfLines={1}>
                {item.title || '新对话'}
              </Text>
              <Text style={styles.itemMeta}>
                {item.model} · {formatTime(item.createdAt)}
              </Text>
            </View>
            <Pressable style={styles.deleteButton} onPress={() => handleDelete(item)}>
              <Text style={styles.deleteIcon}>×</Text>
            </Pressable>
          </Pressable>
        )}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>暂无历史对话</Text>
          </View>
        }
      />

      {/* Edit title modal */}
      <Modal visible={!!editingConv} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => setEditingConv(null)}>
          <View style={styles.modal} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>编辑标题</Text>
            <TextInput
              style={styles.modalInput}
              value={editTitle}
              onChangeText={setEditTitle}
              autoFocus
              selectTextOnFocus
              placeholder="输入对话标题"
              placeholderTextColor={colors.textTertiary}
            />
            <View style={styles.modalButtons}>
              <Pressable style={styles.modalCancel} onPress={() => setEditingConv(null)}>
                <Text style={styles.modalCancelText}>取消</Text>
              </Pressable>
              <Pressable style={styles.modalConfirm} onPress={handleSaveTitle}>
                <Text style={styles.modalConfirmText}>保存</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 50,
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  backButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  backIcon: { fontSize: 22, color: colors.text },
  title: { flex: 1, fontSize: 18, fontWeight: '600', color: colors.text, textAlign: 'center' },
  newButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  newIcon: { fontSize: 20, color: colors.text },
  list: { paddingVertical: 8 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 20,
    paddingRight: 12,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  itemContent: { flex: 1, gap: 4 },
  itemTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  itemMeta: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  deleteButton: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 16,
  },
  deleteIcon: {
    fontSize: 20,
    color: colors.textTertiary,
  },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 120 },
  emptyText: { fontSize: 15, color: colors.textTertiary },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modal: {
    backgroundColor: colors.background,
    borderRadius: 16,
    padding: 24,
    width: '80%',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 16,
  },
  modalInput: {
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: colors.text,
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  modalCancel: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  modalCancelText: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  modalConfirm: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  modalConfirmText: {
    fontSize: 15,
    color: '#FFFFFF',
    fontWeight: '500',
  },
});
