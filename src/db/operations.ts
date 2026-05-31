import { getDatabase } from './database';
import { Conversation, Message, Diary, HiddenRange, ToolInvocation } from '../types';

export async function createConversation(conv: Conversation): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO conversations (id, title, system_prompt, model, created_at, updated_at, hidden_ranges)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      conv.id,
      conv.title,
      conv.systemPrompt,
      conv.model,
      conv.createdAt,
      conv.updatedAt,
      JSON.stringify(conv.hiddenRanges ?? []),
    ]
  );
}

export async function updateConversation(id: string, updates: Partial<Pick<Conversation, 'title' | 'updatedAt'>>): Promise<void> {
  const db = await getDatabase();
  const sets: string[] = [];
  const values: any[] = [];

  if (updates.title !== undefined) {
    sets.push('title = ?');
    values.push(updates.title);
  }
  if (updates.updatedAt !== undefined) {
    sets.push('updated_at = ?');
    values.push(updates.updatedAt);
  }

  if (sets.length === 0) return;
  values.push(id);
  await db.runAsync(`UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`, values);
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM messages WHERE conversation_id = ?', [id]);
  await db.runAsync('DELETE FROM conversations WHERE id = ?', [id]);
}

export async function getAllConversations(): Promise<Conversation[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    title: string;
    system_prompt: string;
    model: string;
    created_at: number;
    updated_at: number;
    hidden_ranges: string | null;
  }>('SELECT * FROM conversations ORDER BY created_at DESC');

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    systemPrompt: row.system_prompt,
    model: row.model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hiddenRanges: parseHiddenRanges(row.hidden_ranges),
  }));
}

/* ==================== 隐藏楼层范围 CRUD ==================== */

// 容错解析：损坏或非数组的 JSON 一律退回空数组
function parseHiddenRanges(raw: string | null | undefined): HiddenRange[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r) => r && typeof r.from === 'number' && typeof r.to === 'number'
    );
  } catch {
    return [];
  }
}

export async function getHiddenRanges(conversationId: string): Promise<HiddenRange[]> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ hidden_ranges: string | null }>(
    'SELECT hidden_ranges FROM conversations WHERE id = ?',
    [conversationId]
  );
  return parseHiddenRanges(row?.hidden_ranges);
}

export async function updateHiddenRanges(
  conversationId: string,
  ranges: HiddenRange[]
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE conversations SET hidden_ranges = ? WHERE id = ?', [
    JSON.stringify(ranges),
    conversationId,
  ]);
}

export async function insertMessage(conversationId: string, msg: Message): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO messages (id, conversation_id, role, content, tool_calls, tool_call_id, tool_invocations, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      msg.id,
      conversationId,
      msg.role,
      msg.content,
      msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
      msg.toolCallId || null,
      msg.toolInvocations && msg.toolInvocations.length > 0 ? JSON.stringify(msg.toolInvocations) : null,
      msg.createdAt,
    ]
  );
}

export async function updateMessageContent(id: string, content: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE messages SET content = ? WHERE id = ?', [content, id]);
}

// 把某条消息的工具调用记录落库（流式收尾时调用）。空数组写 null。
export async function updateMessageToolInvocations(
  id: string,
  invocations: ToolInvocation[] | undefined
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE messages SET tool_invocations = ? WHERE id = ?', [
    invocations && invocations.length > 0 ? JSON.stringify(invocations) : null,
    id,
  ]);
}

export async function deleteMessage(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM messages WHERE id = ?', [id]);
}

export async function getMessagesByConversation(conversationId: string): Promise<Message[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    role: string;
    content: string;
    tool_calls: string | null;
    tool_call_id: string | null;
    tool_invocations: string | null;
    created_at: number;
  }>('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC', [conversationId]);

  return rows.map((row) => ({
    id: row.id,
    role: row.role as Message['role'],
    content: row.content,
    toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
    toolCallId: row.tool_call_id || undefined,
    toolInvocations: row.tool_invocations ? JSON.parse(row.tool_invocations) : undefined,
    createdAt: row.created_at,
  }));
}

/* ==================== 日记 Diary CRUD ==================== */

function mapDiaryRow(row: {
  id: string;
  title: string;
  content: string;
  is_favorite: number;
  created_at: number;
  updated_at: number;
}): Diary {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    isFavorite: row.is_favorite === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createDiary(diary: Diary): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO diaries (id, title, content, is_favorite, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      diary.id,
      diary.title,
      diary.content,
      diary.isFavorite ? 1 : 0,
      diary.createdAt,
      diary.updatedAt,
    ]
  );
}

export async function updateDiary(
  id: string,
  updates: Partial<Pick<Diary, 'title' | 'content' | 'isFavorite' | 'updatedAt'>>
): Promise<void> {
  const db = await getDatabase();
  const sets: string[] = [];
  const values: any[] = [];

  if (updates.title !== undefined) {
    sets.push('title = ?');
    values.push(updates.title);
  }
  if (updates.content !== undefined) {
    sets.push('content = ?');
    values.push(updates.content);
  }
  if (updates.isFavorite !== undefined) {
    sets.push('is_favorite = ?');
    values.push(updates.isFavorite ? 1 : 0);
  }
  if (updates.updatedAt !== undefined) {
    sets.push('updated_at = ?');
    values.push(updates.updatedAt);
  }

  if (sets.length === 0) return;
  values.push(id);
  await db.runAsync(`UPDATE diaries SET ${sets.join(', ')} WHERE id = ?`, values);
}

export async function deleteDiary(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM diaries WHERE id = ?', [id]);
}

export async function getAllDiaries(): Promise<Diary[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    title: string;
    content: string;
    is_favorite: number;
    created_at: number;
    updated_at: number;
  }>('SELECT * FROM diaries ORDER BY updated_at DESC');
  return rows.map(mapDiaryRow);
}

export async function getFavoriteDiaries(): Promise<Diary[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    title: string;
    content: string;
    is_favorite: number;
    created_at: number;
    updated_at: number;
  }>('SELECT * FROM diaries WHERE is_favorite = 1 ORDER BY updated_at DESC');
  return rows.map(mapDiaryRow);
}
