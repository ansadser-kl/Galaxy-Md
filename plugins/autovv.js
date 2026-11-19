"use strict";

const fs = require("fs");
const path = require("path");
const config = require("../config");

// Target chat save cheyyunna file (bot restart kazhinjum undaakum)
const DATA_DIR = path.join(__dirname, "..", "data");
const STORE = path.join(DATA_DIR, "autovv.json");
const RECENT_MAX = 2000;

const recent = new Set();

const digits = (v) => String(v || "").split("@")[0].split(":")[0].replace(/\D/g, "");

// Target: file-il ulla value; file illenkil owner-inte private chat (default ON)
// "off" aanenkil nirthum
function readStore() {
  try {
    const saved = JSON.parse(fs.readFileSync(STORE, "utf8")).target;
    if (saved === "off") return "";
    if (saved) return saved;
  } catch {}
  const owner = digits(config.ownerNumber);
  return owner ? owner + "@s.whatsapp.net" : "";
}

function writeStore(target) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify({ target }, null, 2));
}

function firstTime(key) {
  if (recent.has(key)) return false;
  recent.add(key);
  if (recent.size > RECENT_MAX) recent.delete(recent.values().next().value);
  return true;
}

function unwrap(m) {
  let cur = m || {};
  for (let i = 0; i < 6; i++) {
    const next =
      cur.ephemeralMessage?.message ||
      cur.documentWithCaptionMessage?.message;
    if (!next) break;
    cur = next;
  }
  return cur;
}

// View once message-il ninnu inner media edukkum
function extractViewOnce(message) {
  const m = unwrap(message);
  const wrapper = m.viewOnceMessage || m.viewOnceMessageV2 || m.viewOnceMessageV2Extension;
  if (!wrapper?.message) return null;
  const inner = unwrap(wrapper.message);
  const type = ["imageMessage", "videoMessage", "audioMessage"].find((t) => inner[t]);
  if (!type) return null;
  return { type, message: inner };
}

function loadDownloader() {
  for (const name of ["baileys", "@whiskeysockets/baileys"]) {
    try {
      const mod = require(name);
      if (typeof mod.downloadMediaMessage === "function") return mod.downloadMediaMessage;
    } catch {}
  }
  throw new Error("Baileys downloadMediaMessage not found.");
}

function normalizeJid(input, current) {
  const value = String(input || "").trim().toLowerCase();
  if (!value) return null;
  if (value === "here") return current;
  if (value.includes("@")) {
    return /^[\w.-]+@(s\.whatsapp\.net|g\.us|lid)$/.test(value) ? value : null;
  }
  const d = value.replace(/\D/g, "");
  return d.length >= 7 ? d + "@s.whatsapp.net" : null;
}

function isOwner(message) {
  if (message?.key?.fromMe) return true;
  const owner = digits(config.ownerNumber);
  const sender = digits(message?.key?.participant || message?.key?.participantAlt || message?.key?.remoteJid);
  return !!owner && owner === sender;
}

async function forward(sock, target, message, vv) {
  const sourceChat = message.key.remoteJid;
  const sender = message.key.participant || message.key.participantAlt || sourceChat;
  const senderNum = digits(sender);
  const info =
    `*Auto view once*\nFrom: @${senderNum}\nChat: ${sourceChat.endsWith("@g.us") ? "group " : ""}${digits(sourceChat)}`;

  const downloadMediaMessage = loadDownloader();
  const buffer = await downloadMediaMessage({ key: message.key, message: vv.message }, "buffer", {});
  if (!buffer?.length) throw new Error("view once media download failed");

  const node = vv.message[vv.type];
  const original = node?.caption ? node.caption + "\n\n" : "";
  const mentions = [sender];

  if (vv.type === "imageMessage") {
    await sock.sendMessage(target, { image: buffer, caption: original + info, mentions });
  } else if (vv.type === "videoMessage") {
    await sock.sendMessage(target, { video: buffer, caption: original + info, mimetype: node.mimetype || "video/mp4", mentions });
  } else {
    await sock.sendMessage(target, { text: info, mentions });
    await sock.sendMessage(target, { audio: buffer, mimetype: node.mimetype || "audio/ogg; codecs=opus", ptt: !!node.ptt });
  }
}

module.exports = {
  name: "autovv",
  aliases: [],
  description: "Auto anti view-once: view once media-kal auto-aayi choose cheytha chat-ilekku forward cheyyum",
  category: "Owner",

  // Command: .autovv here | <number/jid> | off | status
  async execute({ sock, jid, message, text, args }) {
    const send = (t) => sock.sendMessage(jid, { text: t }, { quoted: message });
    if (!isOwner(message)) return send("❌ Owner only.");

    const input = String(text || args?.join(" ") || "").trim();
    const arg = input.split(/\s+/).slice(1).join(" ").trim();
    const current = readStore();

    if (!arg || arg.toLowerCase() === "status") {
      const on = !!current;
      return send(
        `*Auto view once*\nStatus: ${on ? "ON ✅" : "OFF ❌"}` +
        (on ? `\nTarget: ${current}` : "") + "\n\n" +
        "Commands:\n.autovv on - on aakkum (ninte number-ilekku)\n.autovv off - off aakkum\n.autovv status - ippo state\n.autovv here - ith chat-ilekku\n.autovv <number> - custom number-ilekku"
      );
    }

    if (arg.toLowerCase() === "on") {
      writeStore("");
      return send("Auto view once ON ✅\nView once media ninte own number-ilekku varum.");
    }

    if (arg.toLowerCase() === "off") {
      writeStore("off");
      return send("Auto view once off ❌");
    }

    const target = normalizeJid(arg, jid);
    if (!target) {
      return send("Invalid chat! `here`, number, allenkil `123456789@s.whatsapp.net` / `...@g.us` use cheyyuka.");
    }
    writeStore(target);
    return send("Auto view once on ✅\nView once media ivide varum: " + target);
  },

  // Passive: ella messages-um nokkum, view once aanenkil forward cheyyum
  async handleMessage({ sock, message }) {
    const shape = Object.keys(message?.message || {}).join(",");
    const inner = message?.message?.ephemeralMessage?.message ? Object.keys(message.message.ephemeralMessage.message).join(",") : "";
    console.log("[GALAXY-MD] autovv hook: from", message?.key?.remoteJid, "keys:", shape, "| ephemeral:", inner);
    const target = readStore();
    if (!target) return false;

    const key = message?.key;
    if (!key?.id || key.fromMe) return false;

    const vv = extractViewOnce(message.message);
    if (!vv) return false;
    console.log("[GALAXY-MD] autovv: view once detected from", key.remoteJid, "-> target", target);

    const dedup = key.remoteJid + ":" + key.id;
    if (!firstTime(dedup)) return false;

    try {
      await forward(sock, target, message, vv);
    } catch (error) {
      recent.delete(dedup);
      console.error("[GALAXY-MD] autovv forward failed:", error?.message || error);
    }
    // false return: matha plugins-um normal aayi work cheyyum
    return false;
  },
};
