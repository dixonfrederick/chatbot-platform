import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true })
fs.mkdirSync(config.uploadsDir, { recursive: true })

const isPostgres = Boolean(config.databaseUrl)

function toPostgresQuery(sql) {
  let index = 0
  return sql.replace(/\?/g, () => `$${++index}`)
}

function normalizeRow(row) {
  if (!row) {
    return row
  }

  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value,
    ]),
  )
}

async function createPostgresDb() {
  const { Pool } = await import('pg')
  const pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseUrl.includes('sslmode=disable')
      ? false
      : {
          rejectUnauthorized: false,
        },
  })

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS prompts (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'Prompt',
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'local',
      model TEXT NOT NULL DEFAULT '',
      response_id TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS files (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size INTEGER NOT NULL DEFAULT 0,
      openai_file_id TEXT NOT NULL DEFAULT '',
      upload_error TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_project_id ON messages(project_id);
    CREATE INDEX IF NOT EXISTS idx_files_project_id ON files(project_id);
  `)

  return {
    dialect: 'postgres',
    async all(sql, params = []) {
      const result = await pool.query(toPostgresQuery(sql), params)
      return result.rows.map(normalizeRow)
    },
    async get(sql, params = []) {
      const result = await pool.query(`${toPostgresQuery(sql)} LIMIT 1`, params)
      return normalizeRow(result.rows[0])
    },
    async run(sql, params = []) {
      const isInsert = /^\s*INSERT\s+INTO/i.test(sql)
      const query = isInsert && !/\bRETURNING\b/i.test(sql) ? `${sql} RETURNING id` : sql
      const result = await pool.query(toPostgresQuery(query), params)

      return {
        changes: result.rowCount,
        lastInsertRowid: result.rows[0]?.id,
      }
    },
  }
}

async function createSqliteDb() {
  const { default: Database } = await import('better-sqlite3')
  const sqlite = new Database(config.dbPath)

  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT 'Prompt',
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'local',
      model TEXT NOT NULL DEFAULT '',
      response_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size INTEGER NOT NULL DEFAULT 0,
      openai_file_id TEXT NOT NULL DEFAULT '',
      upload_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_project_id ON messages(project_id);
    CREATE INDEX IF NOT EXISTS idx_files_project_id ON files(project_id);
  `)

  return {
    dialect: 'sqlite',
    all(sql, params = []) {
      return sqlite.prepare(sql).all(...params)
    },
    get(sql, params = []) {
      return sqlite.prepare(sql).get(...params)
    },
    run(sql, params = []) {
      return sqlite.prepare(sql).run(...params)
    },
  }
}

export const db = isPostgres ? await createPostgresDb() : await createSqliteDb()
