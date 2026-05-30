import { create } from 'zustand';
import { Message, Conversation, HiddenRange } from '../types';
import { randomUUID } from 'expo-crypto';
import { streamChat, chatCompletion } from '../services/api';
import { useSettingsStore } from './settings';
import { getToolDefinitions, executeTool } from '../services/tools';
import { formatCurrentTime, formatTimeMarker, TIME_GAP_THRESHOLD_MS } from '../utils/time';
import { mergeRanges } from '../utils/ranges';
import {
  createConversation,
  updateConversation,
  insertMessage,
  updateMessageContent,
  deleteMessage,
  getMessagesByConversation,
  getHiddenRanges,
  updateHiddenRanges,
  getFavoriteDiaries,
} from '../db/operations';

interface ChatState {
  conversationId: string | null;
  messages: Message[];
  hiddenRanges: HiddenRange[];
  isStreaming: boolean;
  error: string | null;

  sendMessage: (content: string) => Promise<void>;
  addUserMessage: (content: string) => Promise<void>;
  triggerResponse: () => Promise<void>;
  stopStreaming: () => void;
  newConversation: () => void;
  loadConversation: (id: string) => Promise<void>;
  setError: (error: string | null) => void;
  editMessage: (id: string, content: string) => Promise<void>;
  removeMessage: (id: string) => Promise<void>;
  regenerate: () => Promise<void>;
  addHiddenRange: (range: HiddenRange) => Promise<void>;
  removeHiddenRange: (index: number) => Promise<void>;
  setHiddenRanges: (ranges: HiddenRange[]) => Promise<void>;
}

let abortController: AbortController | null = null;

/**
 * Tool Use 循环。
 * 返回最终的 assistant 文本内容；若没有启用任何工具则返回 null（调用方走流式路径）。
 */
async function runToolLoop(
  config: { baseUrl: string; apiKey: string; model: string },
  systemPrompt: string,
  memoryMessages: { role: string; content: string }[],
  apiMessages: { role: string; content: string }[],
  maxTokens: number | undefined
): Promise<string | null> {
  const settings = useSettingsStore.getState();
  const memoryEnabled = settings.memoryVaultConfig.enabled && !!settings.memoryVaultConfig.baseUrl;
  const webEnabled = settings.webSearchConfig.enabled && !!settings.webSearchConfig.tavilyApiKey;

  const tools = getToolDefinitions({ memoryVault: memoryEnabled, webSearch: webEnabled });
  if (tools.length === 0) {
    return null; // 无工具 → 走原有流式路径
  }

  // 每轮最大工具调用次数（记忆库配置；联网搜索复用同一上限）
  const maxToolCalls = Math.max(1, settings.memoryVaultConfig.maxToolCalls || 3);

  // 构建对话消息（含 system + 近期日记）
  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    ...memoryMessages,
    ...apiMessages,
  ];

  let toolCallCount = 0;

  while (true) {
    const resp = await chatCompletion({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      messages,
      maxTokens,
      tools,
    });

    const choice = resp.choices?.[0];
    if (!choice) {
      return '';
    }

    const message = choice.message;
    const toolCalls = message.tool_calls;

    // 没有工具调用，或已达上限 → 返回最终内容
    if (!toolCalls || toolCalls.length === 0 || toolCallCount >= maxToolCalls) {
      return message.content || '';
    }

    // 将 assistant 的 tool_calls 消息追加到上下文
    messages.push({
      role: 'assistant',
      content: message.content || '',
      tool_calls: toolCalls,
    });

    // 依次执行每个工具调用，结果作为 tool message 追加
    for (const tc of toolCalls) {
      toolCallCount++;
      let args: Record<string, any> = {};
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        args = {};
      }
      const result = await executeTool(tc.function.name, args, {
        memoryVaultConfig: settings.memoryVaultConfig,
        webSearchConfig: settings.webSearchConfig,
      });
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      });
    }
    // 继续循环，让模型基于工具结果生成回复
  }
}

/**
 * 共享的流式回复逻辑。
 * 前提：调用方已经把要回复的上下文消息放进了 state.messages。
 * 本函数负责：创建空 assistant 消息 → 持久化 → 构建 apiMessages
 * → 走 tool-loop 或流式 → 落库收尾。
 */
async function streamAssistantResponse(
  get: () => ChatState,
  set: (partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void,
  conversationId: string
): Promise<void> {
  const settings = useSettingsStore.getState();
  const config = settings.apiConfigs[settings.activeConfigIndex];
  if (!config || !config.baseUrl || !config.apiKey) {
    set({ error: '请先在设置中配置 API', isStreaming: false });
    return;
  }

  const assistantMessage: Message = {
    id: randomUUID(),
    role: 'assistant',
    content: '',
    createdAt: Date.now(),
  };

  set((state) => ({
    messages: [...state.messages, assistantMessage],
  }));

  await insertMessage(conversationId, assistantMessage);

  const allMessages = get().messages;
  // 隐藏楼层现在按对话独立存储，从 chat store 自身读取。
  const hiddenRanges = get().hiddenRanges;
  // 先按 role 过滤并去掉刚创建的空 assistant 占位，再按隐藏区间过滤，
  // 全程保留 createdAt 以便推导相邻消息的时间间隔。
  const filtered = allMessages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(0, -1)
    .filter((_, index) => {
      const msgNum = index + 1;
      return !hiddenRanges.some(
        (r) => msgNum >= r.from && msgNum <= r.to
      );
    });

  // 相邻消息间隔超过阈值时，在该消息 content 前插入一行独立时间标记。
  // 第一条消息始终带标记，作为对话起点的时间锚点。
  const apiMessages = filtered.map((m, index) => {
    const prev = index > 0 ? filtered[index - 1] : null;
    const needMarker = !prev || m.createdAt - prev.createdAt >= TIME_GAP_THRESHOLD_MS;
    const content = needMarker
      ? `[时间 ${formatTimeMarker(m.createdAt)}]\n${m.content}`
      : m.content;
    return { role: m.role, content };
  });

  // 当前时间注入到 system prompt 的最前面（所有 prompt 之前）
  const systemPromptWithTime = `当前时间：${formatCurrentTime()}\n\n${settings.systemPrompt}`;

  // 获取已收藏的日记作为「近期日记」，作为独立 system 消息插入到
  // system prompt 之后、对话消息之前。
  let memoryMessages: { role: string; content: string }[] = [];
  try {
    const favoriteDiaries = await getFavoriteDiaries();
    if (favoriteDiaries.length > 0) {
      const memoryContent = favoriteDiaries
        .map((d) => {
          const date = formatTimeMarker(d.createdAt);
          return `【${date}】${d.title}\n${d.content}`;
        })
        .join('\n\n---\n\n');
      memoryMessages = [
        { role: 'system', content: `以下是你的近期日记：\n\n${memoryContent}` },
      ];
    }
  } catch {
    // 读取日记失败时静默忽略，不影响正常对话
  }

  abortController = new AbortController();

  const onToken = (token: string) => {
    set((state) => {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') {
        msgs[msgs.length - 1] = { ...last, content: last.content + token };
      }
      return { messages: msgs };
    });
  };

  const setAssistantContent = (content: string) => {
    set((state) => {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') {
        msgs[msgs.length - 1] = { ...last, content };
      }
      return { messages: msgs };
    });
  };

  try {
    const finalContent = await runToolLoop(
      { baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model },
      systemPromptWithTime,
      memoryMessages,
      apiMessages,
      settings.maxOutputTokens || undefined
    );

    if (finalContent !== null) {
      setAssistantContent(finalContent);
    } else {
      await streamChat(
        {
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          model: config.model,
          messages: [
            { role: 'system', content: systemPromptWithTime },
            ...memoryMessages,
            ...apiMessages,
          ],
          maxTokens: settings.maxOutputTokens || undefined,
        },
        onToken,
        abortController.signal
      );
    }

    const finalMessages = get().messages;
    const lastMsg = finalMessages[finalMessages.length - 1];
    if (lastMsg && lastMsg.role === 'assistant') {
      await updateMessageContent(lastMsg.id, lastMsg.content);
    }

    await updateConversation(conversationId, { updatedAt: Date.now() });
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      set({ error: err.message || '请求失败' });
    }
    const finalMessages = get().messages;
    const lastMsg = finalMessages[finalMessages.length - 1];
    if (lastMsg && lastMsg.role === 'assistant') {
      await updateMessageContent(lastMsg.id, lastMsg.content);
    }
  } finally {
    set({ isStreaming: false });
    abortController = null;
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversationId: null,
  messages: [],
  hiddenRanges: [],
  isStreaming: false,
  error: null,

  // 仅把用户消息加入列表并持久化，不触发 AI 回复。
  addUserMessage: async (content: string) => {
    const { isStreaming } = get();
    if (isStreaming) return;

    let { conversationId } = get();
    const settings = useSettingsStore.getState();
    if (!settings._hydrated) return;
    const config = settings.apiConfigs[settings.activeConfigIndex];

    if (!config || !config.baseUrl || !config.apiKey) {
      set({ error: '请先在设置中配置 API' });
      return;
    }

    if (!conversationId) {
      conversationId = randomUUID();
      const now = Date.now();
      const conv: Conversation = {
        id: conversationId,
        title: content.slice(0, 30),
        systemPrompt: settings.systemPrompt,
        model: config.model,
        createdAt: now,
        updatedAt: now,
      };
      await createConversation(conv);
      set({ conversationId });
    }

    const userMessage: Message = {
      id: randomUUID(),
      role: 'user',
      content,
      createdAt: Date.now(),
    };

    set((state) => ({
      messages: [...state.messages, userMessage],
      error: null,
    }));

    await insertMessage(conversationId, userMessage);
    await updateConversation(conversationId, { updatedAt: Date.now() });
  },

  // 仅触发 AI 回复（针对当前历史消息），不新增用户消息。
  triggerResponse: async () => {
    const { conversationId, messages, isStreaming } = get();
    if (isStreaming || !conversationId || messages.length === 0) return;

    // 防止重复：如果最后一条已经是空的 assistant 消息，不重复创建
    const last = messages[messages.length - 1];
    if (last.role === 'assistant' && last.content === '') return;

    const settings = useSettingsStore.getState();
    if (!settings._hydrated) return;

    set({ isStreaming: true, error: null });
    await streamAssistantResponse(get, set, conversationId);
  },

  // 一体化发送：加用户消息 + 触发 AI 回复（向后兼容）。
  sendMessage: async (content: string) => {
    const { isStreaming } = get();
    if (isStreaming) return;
    await get().addUserMessage(content);
    // addUserMessage 可能因为缺少配置而设置 error 并提前返回，
    // 此时不应继续触发回复。
    if (get().error) return;
    await get().triggerResponse();
  },

  stopStreaming: () => {
    abortController?.abort();
    set({ isStreaming: false });
  },

  newConversation: () => {
    set({ conversationId: null, messages: [], hiddenRanges: [], error: null });
  },

  loadConversation: async (id: string) => {
    const messages = await getMessagesByConversation(id);
    const hiddenRanges = await getHiddenRanges(id);
    set({ conversationId: id, messages, hiddenRanges, error: null });
  },

  setError: (error) => set({ error }),

  // 隐藏楼层：新增范围 → 合并 → 落库。无活跃对话时忽略。
  addHiddenRange: async (range: HiddenRange) => {
    const { conversationId, hiddenRanges } = get();
    if (!conversationId) return;
    const merged = mergeRanges([...hiddenRanges, range]);
    set({ hiddenRanges: merged });
    await updateHiddenRanges(conversationId, merged);
  },

  // 隐藏楼层：按索引删除某条范围 → 落库。
  removeHiddenRange: async (index: number) => {
    const { conversationId, hiddenRanges } = get();
    if (!conversationId) return;
    const next = hiddenRanges.filter((_, i) => i !== index);
    set({ hiddenRanges: next });
    await updateHiddenRanges(conversationId, next);
  },

  // 隐藏楼层：整组替换（合并后）→ 落库。
  setHiddenRanges: async (ranges: HiddenRange[]) => {
    const { conversationId } = get();
    if (!conversationId) return;
    const merged = mergeRanges(ranges);
    set({ hiddenRanges: merged });
    await updateHiddenRanges(conversationId, merged);
  },

  editMessage: async (id: string, content: string) => {
    await updateMessageContent(id, content);
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, content } : m
      ),
    }));
  },

  removeMessage: async (id: string) => {
    await deleteMessage(id);
    set((state) => ({
      messages: state.messages.filter((m) => m.id !== id),
    }));
  },

  regenerate: async () => {
    const { messages, conversationId, isStreaming } = get();
    if (isStreaming || !conversationId) return;

    // 必须存在至少一条 user 消息才能重新生成
    const hasUser = messages.some((m) => m.role === 'user');
    if (!hasUser) return;

    // 删除末尾的 assistant 消息（如果有），然后基于剩余历史重新生成
    const lastAssistant = messages[messages.length - 1];
    if (lastAssistant && lastAssistant.role === 'assistant') {
      await deleteMessage(lastAssistant.id);
      set((state) => ({
        messages: state.messages.filter((m) => m.id !== lastAssistant.id),
      }));
    }

    set({ isStreaming: true, error: null });
    await streamAssistantResponse(get, set, conversationId);
  },
}));
