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

// Prevents the same view-once message from being forwarded twice on duplicate Baileys events.
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

function hasViewOnceWrapper(message) {
  let current = message || {};
  for (let i = 0; i < 8; i++) {
    if (current?.viewOnceMessage || current?.viewOnceMessageV2 || current?.viewOnceMessageV2Extension) {
      return true;
    }
    const next = WRAPPERS.map((key) => current?.[key]?.message).find(Boolean);
    if (!next) break;
    current = next;
  }
  return false;
}

function getViewOnceMedia(message) {
  const raw = message?.message;
  if (!raw) return null;

  const wrapped = hasViewOnceWrapper(raw);
  const msg = unwrapMessage(raw);
  for (const mediaType of MEDIA_KEYS) {
    const media = msg?.[mediaType];
    if (!media) continue;
    // Some Baileys builds keep the wrapper; others only set viewOnce on the media.
    if (wrapped || media.viewOnce === true) return { mediaType, media };
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

async function buildCaption({ sock, jid, message }) {
  const sender = getSender(message);
  const number = digits(sender);
  const name = String(message?.pushName || message?.senderName || "").replace(/[\r\n]+/g, " ").trim().slice(0, 60);
  let chat = "Private chat";

  if (jid?.endsWith("@g.us")) {
    const metadata = await sock.groupMetadata(jid).catch(() => null);
    chat = String(metadata?.subject || jid).replace(/[\r\n]+/g, " ").slice(0, 80);
  }

  return [
    "🔒 *View Once Auto-Save*",
    "👤 From: " + (number ? "@" + number : "Unknown") + (name ? " (" + name + ")" : ""),
    "💬 Chat: " + chat,
    "🕒 " + new Date().toLocaleString(),
  ].join("\n");
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

module.exports = {
  name: "autovv",
  aliases: ["vv", "autoviewonce"],
  description: "Auto-forward view-once media from groups/DMs to the owner",
  category: "Automation",

  // .autovv on | off | status | target <number>
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

  // Passive hook: runs for every normal (non-command) message, including view-once media.
  async handleMessage({ sock, jid, message, config }) {
    if (!jid || jid === "status@broadcast") return false;
    if (message?.key?.fromMe) return false;

    const found = getViewOnceMedia(message);
    if (!found) return false;

    const data = readData();
    if (data.autovv === false) return false;

    const target = getTargetJid(data, config);
    if (!target) {
      console.warn("[GALAXY-MD] autovv: no owner/bot number configured as target.");
      return false;
    }

    const id = message?.key?.id;
    if (id && processed.has(id)) return true;

    const key = id || Math.random().toString(36).slice(2);
    inFlight.add(key);

    try {
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

      const caption = await buildCaption({ sock, jid, message });
      const payload = buildPayload({ ...found, media: { ...found.media, __buffer: buffer } }, caption);
      if (!payload) return false;

      const sender = getSender(message);
      await sock.sendMessage(target, payload, sender && !sender.endsWith("@g.us")
        ? { mentions: [sender] }
        : {});

      processed.add(key);
      if (processed.size > 300) processed.delete(processed.values().next().value);
      console.log("[GALAXY-MD] autovv: view-once media forwarded to " + target);
      return true;
    } catch (error) {
      console.error("[GALAXY-MD] autovv failed:", error?.stack || error);
      return true;
    } finally {
      inFlight.delete(key);
    }
  },
};
