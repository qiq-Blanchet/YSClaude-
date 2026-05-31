import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;
// 首次初始化的 in-flight Promise。多个并发调用者（如冷启动时同时触发的
// 查询）共享同一个初始化过程，避免各自打开/建表造成竞态——这正是本地 APK
// 冷启动首次进入历史列表查到空结果的根因。
let initPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  if (initPromise) return initPromise;

  // 把"打开 + 建表 + 迁移"整体作为一个不可分割的初始化过程缓存起来。
  // 只有它完整 resolve 之后，db 才被赋值、后续查询才会执行——杜绝了
  // "DB 刚 open、表/迁移尚未就绪就被查询"的时序竞态。
  initPromise = (async () => {
    const opened = await SQLite.openDatabaseAsync('ysclaude.db');
    await initTables(opened);
    db = opened;
    return opened;
  })();

  try {
    return await initPromise;
  } catch (e) {
    // 初始化失败则清空 in-flight Promise，允许下次重试，而不是永久卡死。
    initPromise = null;
    throw e;
  }
}

async function initTables(database: SQLite.SQLiteDatabase) {
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      tool_calls TEXT,
      tool_call_id TEXT,
      tool_invocations TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);

    CREATE TABLE IF NOT EXISTS diaries (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      is_favorite INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_diaries_updated ON diaries(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_diaries_favorite ON diaries(is_favorite);
  `);

  await runMigrations(database);
}

/**
 * 基于 PRAGMA user_version 的轻量级 schema 迁移。
 * 每次新增迁移时把目标版本号 +1，并在对应 if 块里执行变更。
 */
async function runMigrations(database: SQLite.SQLiteDatabase) {
  const row = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;

  // v1: 为每个对话独立存储隐藏楼层范围
  if (version < 1) {
    // ALTER TABLE ADD COLUMN 不重写已有行，旧行该列默认 '[]'
    await database.execAsync(
      `ALTER TABLE conversations ADD COLUMN hidden_ranges TEXT NOT NULL DEFAULT '[]';`
    );
    await database.execAsync('PRAGMA user_version = 1;');
  }

  // v2: 为消息记录实际发生的工具调用（用于气泡上方展示）
  if (version < 2) {
    await database.execAsync(
      `ALTER TABLE messages ADD COLUMN tool_invocations TEXT;`
    );
    await database.execAsync('PRAGMA user_version = 2;');
  }
}
