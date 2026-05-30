import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync('ysclaude.db');
    await initTables(db);
  }
  return db;
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
}
