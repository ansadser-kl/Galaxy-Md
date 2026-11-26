"use strict";

const config = require("../config");

const DEFAULT_ALIVE_URL = "https://galaxy-md-w3vr.onrender.com/dl/t2cxehZx6fNI";

function formatUptime(seconds) {
  const sec = Math.max(0, Math.floor(Number(seconds) || 0));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${s}s`].filter(Boolean).join(" ");
}

function getUserJid(message) {
  const candidate =
    message?.key?.participant ||
    message?.key?.participantAlt ||
    message?.key?.remoteJid ||
    "";

  if (candidate.endsWith("@s.whatsapp.net") || candidate.endsWith("@lid")) {
    return candidate;
  }
  return "";
}

function extractNumber(jid) {
  if (!jid) return "";
  return String(jid).split("@")[0].split(":")[0].replace(/\D/g, "");
}

async function fetchImage(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "image/*,*/*"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30000)
  });

  if (!res.ok) {
    throw new Error(`Image HTTP ${res.status}`);
  }

  const contentType = res.headers.get("content-type") || "";
  const buffer = Buffer.from(await res.arrayBuffer());

  if (!buffer.length) {
    throw new Error("Empty image buffer");
  }

  if (contentType && !contentType.startsWith("image/") && !contentType.includes("octet-stream")) {
    throw new Error(`Unexpected content-type: ${contentType}`);
  }

  return buffer;
}

module.exports = {
  name: "alive",
  aliases: [],
  description: "Show simple alive status with uptime and user",

  async execute({ sock, jid, message, config: runtimeConfig }) {
    const cfg = runtimeConfig || config || {};
    const aliveUrl = String(process.env.ALIVE_URL || cfg.ALIVE_URL || cfg.aliveUrl || DEFAULT_ALIVE_URL).trim();

    const userJid = getUserJid(message);
    const userNumber = userJid.endsWith("@s.whatsapp.net") ? extractNumber(userJid) : "";
    const userName =
      String(message?.pushName || message?.senderName || "User")
        .replace(/[\r\n]+/g, "")
        .trim() || "User";

    const userLabel = userNumber ? `@${userNumber}` : userName;
    const uptime = formatUptime(process.uptime());

    const text = [
      "I am alive",
      `Uptime: ${uptime}`,
      `User: ${userLabel}`
    ].join("\n");

    const mentions = userJid ? [userJid] : [];

    if (aliveUrl) {
      try {
        const image = await fetchImage(aliveUrl);
        await sock.sendMessage(
          jid,
          { image, caption: text, mentions },
          { quoted: message }
        );
        return;
      } catch (error) {
        console.error("[GALAXY-MD] Alive image failed:", error?.message || error);
      }
    }

    await sock.sendMessage(
      jid,
      { text, mentions },
      { quoted: message }
    );
  }
};
