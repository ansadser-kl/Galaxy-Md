"use strict";

const fs = require("fs");
const path = require("path");
const pino = require("pino");

const DATA_FILE = path.join(__dirname, "..", "galaxy-data.json");

const WRAPPERS = [
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "ephemeralMessage",
  "documentWithCaptionMessage",
];

const MEDIA_KEYS = [
  "imageMessage",
  "videoMessage",
  "documentMessage",
  "audioMessage",
  "stickerMessage",
];

const processed = new Set();
const inFlight = new Set();

function readData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { return {}; }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function digits(value) {
  return String(value || "").split("@")[0].split(":")[0].replace(/\D/g, "");
}

function unwrapMessage(message) {
  let current = message || {};
  for (let i = 0; i < 8; i++) {
    const next = WRAPPERS.map((key) => current?.[key]?.message).find(Boolean);
    if (!next) break;
    current = next;
  }
  return current;
}

// Baileys often receives only a stub with key.isViewOnce = true and no message body.
function isViewOnceSignal(message) {
  const key = message?.key || {};
  if (key.isViewOnce === true) return true;

  const params = (Array.isArray(message?.messageStubParameters) ? message.messageStubParameters : [])
    .map((value) => String(value || ""));
  if (params.some((value) => /view.?once|view_once/i.test(value))) return true;

  const raw = message?.message;
  if (!raw) return false;
  let current = raw;
  for (let i = 0; i < 8; i++) {
    if (current?.viewOnceMessage || current?.viewOnceMessageV2 || current?.viewOnceMessageV2Extension) {
      const inner = unwrapMessage(raw);
      if (MEDIA_KEYS.some((mediaKey) => inner?.[mediaKey]?.viewOnce === true)) return true;
    }
    const next = WRAPPERS.map((item) => current?.[item]?.message).find(Boolean);
    if (!next) break;
    current = next;
  }
  return MEDIA_KEYS.some((mediaKey) => raw?.[mediaKey]?.viewOnce === true);
}

function getViewOnceMedia(message, flagged) {
  const raw = message?.message;
  if (!raw) return null;
  const msg = unwrapMessage(raw);
  for (const mediaType of MEDIA_KEYS) {
    const media = msg?.[mediaType];
    if (!media) continue;
    if (flagged || media.viewOnce === true) return { mediaType, media };
  }
  return null;
}

function getTargetJid(data, config) {
  const raw = data.autovvTarget || data.ownerNumber || config?.ownerNumber || config?.botNumber || "";
  const number = digits(raw);
  return number ? number + "@s.whatsapp.net" : "";
}

function getSender(message) {
  return message?.key?.participant || message?.key?.participantAlt || message?.key?.remoteJid || "";
}

async function buildCaption({ sock, jid, message, unavailable }) {
  const sender = getSender(message);
  const number = digits(sender);
  const name = String(message?.pushName || message?.senderName || "").replace(/[\r\n]+/g, " ").trim().slice(0, 60);
  let chat = "Private chat";

  if (jid?.endsWith("@g.us")) {
    const metadata = await sock.groupMetadata(jid).catch(() => null);
    chat = String(metadata?.subject || jid).replace(/[\r\n]+/g, " ").slice(0, 80);
  }

  const lines = unavailable
    ? [
        "🔒 *View Once Alert*",
        "👤 From: " + (number ? "@" + number : "Unknown") + (name ? " (" + name + ")" : ""),
        "💬 Chat: " + chat,
        "⚠️ Media not delivered to this Baileys/linked device (stub only).",
      ]
    : [
        "🔒 *View Once Auto-Save*",
        "👤 From: " + (number ? "@" + number : "Unknown") + (name ? " (" + name + ")" : ""),
        "💬 Chat: " + chat,
      ];

  lines.push("🕒 " + new Date().toLocaleString());
  return lines.join("\n");
}

function buildPayload({ mediaType, media }, caption) {
  switch (mediaType) {
    case "imageMessage":
      return { image: media.__buffer, caption, mimetype: media.mimetype || "image/jpeg" };
    case "videoMessage":
      return { video: media.__buffer, caption, mimetype: media.mimetype || "video/mp4" };
    case "documentMessage":
      return {
        document: media.__buffer,
        fileName: media.fileName || "view-once-file",
        mimetype: media.mimetype || "application/octet-stream",
        caption,
      };
    case "audioMessage":
      return {
        audio: media.__buffer,
        mimetype: media.mimetype || "audio/ogg; codecs=opus",
        ptt: !!media.ptt,
      };
    case "stickerMessage":
      return { sticker: media.__buffer };
    default:
      return null;
  }
}

async function handle({ sock, jid, message, config }) {
  if (!jid || jid === "status@broadcast") return false;
  if (!isViewOnceSignal(message)) return false;

  const data = readData();
  if (data.autovv === false) return false;

  const target = getTargetJid(data, config);
  if (!target) {
    console.warn("[GALAXY-MD] autovv: no owner/bot number configured as target.");
    return false;
  }

  const id = message?.key?.id;
  if (id && (processed.has(id) || inFlight.has(id))) return true;
  const key = id || Math.random().toString(36).slice(2);
  inFlight.add(key);

  try {
    const found = getViewOnceMedia(message, message?.key?.isViewOnce === true);
    const caption = await buildCaption({ sock, jid, message, unavailable: !found });
    const sender = getSender(message);
    const opts = sender && !sender.endsWith("@g.us") ? { mentions: [sender] } : {};

    if (!found) {
      await sock.sendMessage(target, { text: caption }, opts);
      processed.add(key);
      if (processed.size > 300) processed.delete(processed.values().next().value);
      console.log("[GALAXY-MD] autovv: view-once stub detected; media unavailable in this Baileys build.");
      return true;
    }

    const baileys = await import("baileys");
    if (typeof baileys.downloadMediaMessage !== "function") {
      throw new Error("Baileys downloadMediaMessage export is unavailable");
    }

    const buffer = await baileys.downloadMediaMessage(message, "buffer", {}, {
      logger: pino({ level: "silent" }),
      reuploadRequest: sock.updateMediaMessage,
    });

    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error("View-once media download returned an empty file");
    }

    const payload = buildPayload({ ...found, media: { ...found.media, __buffer: buffer } }, caption);
    if (!payload) return false;

    await sock.sendMessage(target, payload, opts);
    processed.add(key);
    if (processed.size > 300) processed.delete(processed.values().next().value);
    console.log("[GALAXY-MD] autovv: view-once media forwarded to " + target);
    return true;
  } catch (error) {
    console.error("[GALAXY-MD] autovv failed:", error?.stack || error);
    try {
      const caption = await buildCaption({ sock, jid, message, unavailable: true });
      await sock.sendMessage(target, { text: caption + "\n❌ " + String(error?.message || error).slice(0, 160) });
    } catch {}
    processed.add(key);
    return true;
  } finally {
    inFlight.delete(key);
  }
}

module.exports = {
  name: "autovv",
  aliases: ["vv", "autoviewonce"],
  description: "Auto-forward view-once media/stubs from groups/DMs to the owner",
  category: "Automation",

  async execute({ sock, jid, message, args, query, isPrivileged, config }) {
    const reply = (text) => sock.sendMessage(jid, { text }, { quoted: message });
    const input = String(query || (Array.isArray(args) ? args.join(" ") : "") || "").trim();
    const action = (input.split(/\s+/)[0] || "status").toLowerCase();
    const data = readData();

    if (["on", "off", "target", "number", "set", "clear"].includes(action) && !isPrivileged) {
      return reply("❌ Owner / SUDO mathram use cheyyam.");
    }

    if (action === "on" || action === "off") {
      data.autovv = action === "on";
      writeData(data);
      return reply(action === "on"
        ? "✅ Auto view-once forward ON. View once media ellam owner-lekk ayakkum."
        : "⛔ Auto view-once forward OFF.");
    }

    if (["target", "number", "set"].includes(action)) {
      const number = digits(input.replace(/^\S+\s*/, ""));
      if (!number) return reply("Usage: .autovv target <number>");
      data.autovvTarget = number;
      writeData(data);
      return reply("✅ View-once forward target set: " + number);
    }

    if (action === "clear") {
      delete data.autovvTarget;
      writeData(data);
      return reply("✅ Target cleared. Owner / bot number use cheyyum.");
    }

    const status = data.autovv === false ? "OFF ⛔" : "ON ✅";
    const target = getTargetJid(data, config) || "Not configured ⚠️";
    return reply(
      "*Auto View Once*\nStatus: " + status +
      "\nTarget: " + target +
      "\n\nUse: .autovv on | .autovv off | .autovv target <number> | .autovv status"
    );
  },

  // Raw hook (called by patched index.js even when a message has no body).
  async handleRawMessage(ctx) {
    return handle(ctx);
  },

  // Normal passive hook (kept for compatibility).
  async handleMessage(ctx) {
    return handle(ctx);
  },
};
