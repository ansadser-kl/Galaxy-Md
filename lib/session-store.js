"use strict";

// Registry + folder helpers for multi-session (bot cloning) support.
// This module has no Baileys dependency on purpose: index.js owns the sockets,
// plugins only talk to it through lib/runtime.js.

try { require("dotenv").config(); } catch {}

const fs = require("fs");
const path = require("path");

const APP_ROOT = path.join(__dirname, "..");
const BASE_DIR = process.env.SESSION_DIR
  ? path.resolve(process.env.SESSION_DIR)
  : path.join(APP_ROOT, "session");
const REGISTRY_PATH = path.join(path.dirname(BASE_DIR), "galaxy-sessions.json");

function parseLimit(value) {
  const parsed = parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : NaN;
}

// Total live WhatsApp accounts in one deployment (main + clones). Default: 4.
const MAX_SESSIONS = Math.max(1, Math.min(10,
  parseLimit(process.env.MAX_SESSIONS ?? process.env.MAX_PAIRS) || 4
));

function sanitizeNumber(value) {
  return String(value || "").replace(/\D/g, "");
}

function isValidNumber(value) {
  const number = sanitizeNumber(value);
  return number.length >= 8 && number.length <= 15;
}

function sessionDir(slot) {
  const id = Number(slot);
  return id === 1 ? BASE_DIR : path.resolve(`${BASE_DIR}${id}`);
}

function emptyRegistry() {
  return { clones: [] };
}

function readRegistry() {
  try {
    const raw = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
    const seenSlots = new Set();
    const seenNumbers = new Set();
    const clones = (Array.isArray(raw?.clones) ? raw.clones : []).reduce((list, item) => {
      const slot = Number(item?.slot);
      const number = sanitizeNumber(item?.number);
      if (!Number.isInteger(slot) || slot < 2 || slot > MAX_SESSIONS) return list;
      if (seenSlots.has(slot)) return list;
      if (number && seenNumbers.has(number)) return list;
      seenSlots.add(slot);
      if (number) seenNumbers.add(number);
      list.push({ slot, number });
      return list;
    }, []);
    return { clones };
  } catch {
    return emptyRegistry();
  }
}

function writeRegistry(registry) {
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  const tmp = REGISTRY_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(registry, null, 2) + "\n");
  fs.renameSync(tmp, REGISTRY_PATH);
}

function listClones() {
  return readRegistry().clones.map((clone) => ({
    ...clone,
    dir: sessionDir(clone.slot),
  }));
}

function getUsedSlots() {
  return [1, ...readRegistry().clones.map((clone) => clone.slot)];
}

function isNumberPaired(number) {
  const clean = sanitizeNumber(number);
  if (!clean) return false;
  const main = sanitizeNumber(process.env.BOT_NUMBER);
  if (clean === main) return true;
  return readRegistry().clones.some((clone) => clone.number === clean);
}

// Reserve the next free clone slot (2, 3, ... MAX_SESSIONS).
function addClone(number) {
  const clean = sanitizeNumber(number);
  if (!isValidNumber(clean)) return null;

  const registry = readRegistry();
  if (isNumberPaired(clean)) return null;

  const taken = new Set(registry.clones.map((clone) => clone.slot));
  let slot = null;
  for (let candidate = 2; candidate <= MAX_SESSIONS; candidate++) {
    if (!taken.has(candidate)) { slot = candidate; break; }
  }
  if (!slot) return null;

  registry.clones.push({ slot, number: clean });
  writeRegistry(registry);
  return { slot, number: clean, dir: sessionDir(slot) };
}

function removeClone({ number, slot } = {}) {
  const registry = readRegistry();
  const clean = sanitizeNumber(number);
  const wantedSlot = Number(slot);
  const removed = registry.clones.filter((clone) =>
    (clean && clone.number === clean) ||
    (Number.isInteger(wantedSlot) && clone.slot === wantedSlot)
  );
  if (!removed.length) return [];
  registry.clones = registry.clones.filter((clone) => !removed.includes(clone));
  writeRegistry(registry);
  return removed;
}

function numberFromCreds(dir) {
  try {
    const creds = JSON.parse(fs.readFileSync(path.join(dir, "creds.json"), "utf8"));
    return sanitizeNumber(creds?.me?.id || creds?.me?.lid || "");
  } catch {
    return "";
  }
}

// Pick up clone folders that exist on disk but are missing from the registry
// (for example after a manual file restore or an interrupted write).
function discoverOrphans() {
  const registry = readRegistry();
  const taken = new Set(registry.clones.map((clone) => clone.slot));
  let changed = false;

  for (let slot = 2; slot <= MAX_SESSIONS; slot++) {
    if (taken.has(slot)) continue;
    const dir = sessionDir(slot);
    if (!fs.existsSync(path.join(dir, "creds.json"))) continue;
    registry.clones.push({ slot, number: numberFromCreds(dir) });
    taken.add(slot);
    changed = true;
  }

  if (changed) writeRegistry(registry);
  return readRegistry().clones;
}

function removeSessionDir(slot) {
  try {
    fs.rmSync(sessionDir(slot), { recursive: true, force: true });
    return true;
  } catch (error) {
    console.error("[GALAXY-MD] Could not delete session folder for slot " + slot + ":", error.message || error);
    return false;
  }
}

module.exports = {
  APP_ROOT,
  BASE_DIR,
  REGISTRY_PATH,
  MAX_SESSIONS,
  sanitizeNumber,
  isValidNumber,
  sessionDir,
  readRegistry,
  writeRegistry,
  listClones,
  getUsedSlots,
  isNumberPaired,
  addClone,
  removeClone,
  discoverOrphans,
  removeSessionDir,
};
