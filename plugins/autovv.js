"use strict";

const fs = require("fs");
const path = require("path");
const config = require("../config");

const DATA_DIR = path.join(__dirname, "..", "data");
const STORE = path.join(DATA_DIR, "autovv.json");
const RECENT_MAX = 2000;
const NOTICE_GAP = 6 * 60 * 60 * 1000; // stub notice 6 hour-il oru thavana mathram

const recent = new Set();
let lastNotice = 0;

const digits = (v) => String(v || "").split("@")[0].split(":")[0].replace(/\D/g, "");
const isAndroidBrowser = () => String(process.env.WA_BROWSER || "").toLowerCase() === "android";

// ---------- Target store (default: owner-inte own number, ON) ----------
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

// ---------- View once detection ----------
const MEDIA = ["imageMessage", "videoMessage", "audioMessage"];
const WRAPPERS = ["viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension"];

function walk(node, visit, depth = 0) {
  if (!node || typeof node !== "object" || depth > 10) return null;
  const hit = visit(node);
  if (hit) return hit;
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") {
      const found = walk(value, visit, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

// Media message, viewOnce === true, download-inu mediaKey venam
function findViewOnceMedia(message) {
  return walk(message, (node) => {
    for (const type of MEDIA) {
      const media = node[type];
      const downloadable = media && (media.mediaKey || media.directPath || media.url);
      if (media && media.viewOnce === true && downloadable) return { type, node: media };
    }
    return null;
  });
}

// WhatsApp media ayakkaathe verum placeholder / empty wrapper ayachaal
function isViewOnceStub(message) {
  if (!message || typeof message !== "object") return false;
  if (message.placeholderMessage) return true;
  return !!walk(message, (node) => {
    for (const w of WRAPPERS) {
      if (node[w]) {
        const inner = node[w].message;
        const hasMedia = inner && MEDIA.some((t) => inner[t]?.mediaKey || inner[t]?.directPath || inner[t]?.url);
        if (!hasMedia) return true;
      }
    }
    return null;
  });
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

// ---------- Forward ----------
async function forward(sock, target, message, found) {
  const sourceChat = message.key.remoteJid;
  const sender = message.key.participant || message.key.participantAlt || sourceChat;
  const info =
    `*Auto view once*\nFrom: @${digits(sender)}\nChat: ${sourceChat.endsWith("@g.us") ? "group " : ""}${digits(sourceChat)}`;

  const downloadMediaMessage = loadDownloader();
  const buffer = await downloadMediaMessage(
    { key: message.key, message: { [found.type]: found.node } },
    "buffer",
    {}
  );
  if (!buffer?.length) throw new Error("view once media download failed");

  const original = found.node.caption ? found.node.caption + "\n\n" : "";
  const mentions = [sender];

  if (found.type === "imageMessage") {
    await sock.sendMessage(target, { image: buffer, caption: original + info, mentions });
  } else if (found.type === "videoMessage") {
    await sock.sendMessage(target, { video: buffer, caption: original + info, mimetype: found.node.mimetype || "video/mp4", mentions });
  } else {
    await sock.sendMessage(target, { text: info, mentions });
    await sock.sendMessage(target, { audio: buffer, mimetype: found.node.mimetype || "audio/ogg; codecs=opus", ptt: !!found.node.ptt });
  }
}

// ---------- Plugin ----------
module.exports = {
  name: "autovv",
  aliases: [],
  description: "Auto anti view-once: view once media auto-aayi owner number-ilekku forward cheyyum",
  category: "Owner",

  // .autovv on | off | status | here | <number/jid>
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
        (on ? `\nTarget: ${current}` : "") +
        `\nBrowser: ${isAndroidBrowser() ? "android ✅" : "not android ⚠️ (WhatsApp view once media ayakkilla)"}\n\n` +
        "Commands:\n.autovv on\n.autovv off\n.autovv status\n.autovv here - ith chat-ilekku\n.autovv <number> - custom number-ilekku"
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

  // Ella messages-um nokkum
  async handleMessage({ sock, message }) {
    const target = readStore();
    if (!target) return false;

    const key = message?.key;
    if (!key?.id || key.fromMe) return false;

    const found = findViewOnceMedia(message.message);

    if (found) {
      const dedup = key.remoteJid + ":" + key.id;
      if (!firstTime(dedup)) return false;
      console.log("[GALAXY-MD] autovv: view once detected from", key.remoteJid, "-> target", target);
      try {
        await forward(sock, target, message, found);
        console.log("[GALAXY-MD] autovv: forwarded to", target);
      } catch (error) {
        recent.delete(dedup);
        console.error("[GALAXY-MD] autovv forward failed:", error?.message || error);
      }
      return false;
    }

    // Media illaathe stub aanenkil: karanam kaanikkum
    if (isViewOnceStub(message.message)) {
      console.warn(
        "[GALAXY-MD] autovv: view once ethi, pakshe WhatsApp media ayachilla (placeholder). " +
        "Browser-type linked device-inu view once kittilla. .env-il WA_BROWSER=android set cheythu restart cheyyuka (venamenkil number veendum link cheyyuka)."
      );
      if (Date.now() - lastNotice > NOTICE_GAP) {
        lastNotice = Date.now();
        try {
          await sock.sendMessage(target, {
            text:
              "*Auto view once*\nOru view once ethi, pakshe WhatsApp media bot-inu ayachilla. " +
              "Browser-type linked device-inu view once kittilla.\n\n" +
              `Browser: ${isAndroidBrowser() ? "android" : "not android"}\n` +
              "Fix: .env-il `WA_BROWSER=android` ittu bot restart cheyyuka. Pinneyum varunnillenkil number veendum link cheyyuka.",
          });
        } catch {}
      }
    }
    return false;
  },
};
