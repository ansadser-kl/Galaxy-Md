"use strict";

const config = require("../config");

const IMAGE_URL = "https://ansadkl-file.onrender.com/dl/41u82B_1_N66";

const SMALL = {
  a: "ᴀ", b: "ʙ", c: "ᴄ", d: "ᴅ", e: "ᴇ", f: "ꜰ", g: "ɢ", h: "ʜ", i: "ɪ", j: "ᴊ",
  k: "ᴋ", l: "ʟ", m: "ᴍ", n: "ɴ", o: "ᴏ", p: "ᴘ", q: "ǫ", r: "ʀ", s: "ꜱ", t: "ᴛ",
  u: "ᴜ", v: "ᴠ", w: "ᴡ", x: "x", y: "ʏ", z: "ᴢ"
};
const small = (s) => String(s).toLowerCase().replace(/[a-z]/g, (c) => SMALL[c]);

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [d && `${d}ᴅ`, h && `${h}ʜ`, m && `${m}ᴍ`, `${s}ꜱ`].filter(Boolean).join(" ");
}

function getUserJid(message) {
  const participant = message?.key?.participant || message?.key?.participantAlt;
  if (participant && participant.includes("@")) return participant;
  const remoteJid = message?.key?.remoteJid || "";
  if (remoteJid.endsWith("@s.whatsapp.net")) return remoteJid;
  return "";
}

async function fetchImage(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "image/*,*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(60000)
  });
  if (!res.ok) throw new Error("Image HTTP " + res.status);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error("Empty image");
  return buffer;
}

module.exports = {
  name: "alive",
  aliases: [],
  description: "Show bot status, user, uptime, owner and mode",
  async execute({ sock, jid, message, config: runtimeConfig }) {
    const cfg = runtimeConfig || config;
    const ownerNumber = String(cfg.ownerNumber || "").replace(/\D/g, "");
    const ownerJid = ownerNumber ? `${ownerNumber}@s.whatsapp.net` : "";
    const userJid = getUserJid(message);
    const userNumber = userJid ? userJid.split("@")[0].split(":")[0] : "";
    const userName = String(message?.pushName || message?.senderName || "User").replace(/[\r\n]+/g, "");
    const mode = String(cfg.mode || "public").toUpperCase();
    const userLabel = userNumber ? `@${userNumber}` : userName;
    const ownerLabel = ownerNumber ? `@${ownerNumber}` : "Not set";

    const text = [
      `✨ *GALAXY-MD* ✨`,
      ``,
      `*${small("bot name")}* : 𝑮𝑨𝑳𝑨𝑿𝒀-𝑴𝑫`,
      `*${small("user")}* : ${userLabel}`,
      `*${small("uptime")}* : ${formatUptime(process.uptime())}`,
      `*${small("owner")}* : ${ownerLabel}`,
      `*${small("status")}* : ${small("online")} ✅`,
      `*${small("mode")}* : ${small(mode)}`,
    ].join("\n");

    const mentions = [userJid, ownerJid].filter(Boolean);

    try {
      const image = await fetchImage(IMAGE_URL);
      await sock.sendMessage(jid, { image, caption: text, mentions }, { quoted: message });
    } catch (error) {
      console.error("[GALAXY-MD] Alive image failed:", error?.message);
      await sock.sendMessage(jid, { text, mentions }, { quoted: message });
    }
  },
};
