"use strict";

const { Pool } = require("pg");

const connectionString = String(process.env.AI_DATABASE_URL || "").trim();
let pool = null;
let schemaReady = null;
let warnedMissingUrl = false;

function getPool() {
  if (!connectionString) {
    if (!warnedMissingUrl) {
      warnedMissingUrl = true;
      console.warn("[GALAXY-MD AI] AI_DATABASE_URL is not configured; persistent chat memory is disabled.");
    }
    return null;
  }
  if (!pool) {
    pool = new Pool({
      connectionString,
      ssl: /localhost|127\.0\.0\.1/i.test(connectionString) ? false : { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    pool.on("error", (error) => console.error("[GALAXY-MD AI] Database pool error:", error.message || error));
  }
  return pool;
}

async function ensureSchema(db) {
  if (!schemaReady) {
    schemaReady = db.query(`
      CREATE TABLE IF NOT EXISTS galaxy_ai_chat_memory (
        id BIGSERIAL PRIMARY KEY,
        chat_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS galaxy_ai_chat_memory_chat_id_id_idx
        ON galaxy_ai_chat_memory (chat_id, id DESC);
    `).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

async function getRecentHistory(chatId, limit = 12) {
  const db = getPool();
  if (!db) return [];
  await ensureSchema(db);
  const result = await db.query(
    "SELECT role, content FROM galaxy_ai_chat_memory WHERE chat_id = $1 ORDER BY id DESC LIMIT $2",
    [String(chatId), Math.max(1, Math.min(Number(limit) || 12, 30))]
  );
  return result.rows.reverse().map((row) => ({ role: row.role, content: row.content }));
}

async function saveTurn(chatId, role, content) {
  const db = getPool();
  if (!db || !String(content || "").trim()) return;
  await ensureSchema(db);
  // Store text only. Media buffers, attachments, and URLs to media files are never persisted here.
  await db.query(
    "INSERT INTO galaxy_ai_chat_memory (chat_id, role, content) VALUES ($1, $2, $3)",
    [String(chatId), role, String(content).slice(0, 12000)]
  );
}

module.exports = { getRecentHistory, saveTurn };
