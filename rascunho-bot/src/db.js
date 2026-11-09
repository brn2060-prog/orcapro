import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export function openDb(file = process.env.DB_PATH || "./data/consultorio.db") {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS patients (
      phone TEXT PRIMARY KEY,
      name TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      name TEXT NOT NULL,
      procedure TEXT NOT NULL,
      date TEXT NOT NULL,          -- YYYY-MM-DD (horário local do consultório)
      time TEXT NOT NULL,          -- HH:MM
      duration INTEGER NOT NULL,   -- minutos
      status TEXT NOT NULL DEFAULT 'agendado', -- agendado | confirmado | cancelado | concluido | faltou
      notes TEXT,
      source TEXT NOT NULL DEFAULT 'whatsapp',  -- whatsapp | painel
      reminder_sent_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments(date, status);
    CREATE INDEX IF NOT EXISTS idx_appt_phone ON appointments(phone);

    CREATE TABLE IF NOT EXISTS blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      start TEXT NOT NULL,
      end TEXT NOT NULL,
      reason TEXT
    );

    -- Histórico completo enviado ao Claude (inclui blocos de ferramenta/raciocínio).
    CREATE TABLE IF NOT EXISTS conversations (
      phone TEXT PRIMARY KEY,
      messages_json TEXT NOT NULL DEFAULT '[]',
      last_activity INTEGER NOT NULL,
      bot_paused_until INTEGER NOT NULL DEFAULT 0
    );

    -- Registro legível para o painel.
    CREATE TABLE IF NOT EXISTS message_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      direction TEXT NOT NULL,  -- in | out | equipe | sistema
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_log_phone ON message_log(phone, id);

    CREATE TABLE IF NOT EXISTS processed_messages (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

export function logMessage(db, phone, direction, text) {
  db.prepare("INSERT INTO message_log (phone, direction, text, created_at) VALUES (?, ?, ?, ?)")
    .run(phone, direction, text, Date.now());
}

/** Retorna true se a mensagem já foi processada (webhooks podem ser reenviados). */
export function alreadyProcessed(db, id) {
  if (!id) return false;
  const r = db.prepare("INSERT OR IGNORE INTO processed_messages (id, created_at) VALUES (?, ?)").run(id, Date.now());
  return r.changes === 0;
}

export function upsertPatient(db, phone, name) {
  db.prepare(`
    INSERT INTO patients (phone, name, created_at) VALUES (?, ?, ?)
    ON CONFLICT(phone) DO UPDATE SET name = COALESCE(excluded.name, patients.name)
  `).run(phone, name || null, Date.now());
}

export function getPatient(db, phone) {
  return db.prepare("SELECT * FROM patients WHERE phone = ?").get(phone);
}

export function pauseBot(db, phone, hours) {
  const until = hours > 0 ? Date.now() + hours * 3600_000 : 0;
  db.prepare(`
    INSERT INTO conversations (phone, last_activity, bot_paused_until) VALUES (?, ?, ?)
    ON CONFLICT(phone) DO UPDATE SET bot_paused_until = excluded.bot_paused_until
  `).run(phone, Date.now(), until);
  return until;
}

export function isBotPaused(db, phone) {
  const row = db.prepare("SELECT bot_paused_until FROM conversations WHERE phone = ?").get(phone);
  return !!row && row.bot_paused_until > Date.now();
}
