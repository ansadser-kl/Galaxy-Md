"use strict";

const config = require("../config");

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return [
    days ? `${days}d` : "",
    hours ? `${hours}h` : "",
    minutes ? `${minutes}m` : "",
    `${secs}s`,
  ].filter(Boolean).join(" ");
}

function getUserJid(message) {
  const participant = message?.key?.participant || message?.key?.participantAlt;
  if (participant && participant.includes("@")) return participant;
  const remoteJid = message?.key?.remoteJid || "";
  if (remoteJid.endsWith("@s.whatsapp.net")) return remoteJid;
  return "";
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
    const botNames = [
      "ɢᴀʟᴀxʏ-ᴍᴅ",
      "ＧＡＬＡＸＹ-ＭＤ",
      "𝙂𝘼𝙇𝘼𝙓𝙔-𝙈𝘿",
      "𝑮𝑨𝑳𝑨𝑿𝒀-𝑴𝑫",
      "𝓖𝓐𝓛𝓐𝓧𝓨-𝓜𝓓",
    ];
    const botName = botNames[0];
    const mode = String(cfg.mode || "public").toUpperCase();
    const userLabel = userNumber ? `@${userNumber}` : userName;
    const ownerLabel = ownerNumber ? `@${ownerNumber}` : "Not set";

    const text = [
      "╭━━〔 ✨ *GALAXY-MD* ✨ 〕━━╮",
      `┃ *ʙᴏᴛ ɴᴀᴍᴇ* : ${botName}`,
      `┃ *ᴜsᴇʀ* : ${userLabel}`,
      `┃ *ᴜᴘᴛɪᴍᴇ* : ${formatUptime(process.uptime())}`,
      `┃ *ᴏᴡɴᴇʀ* : ${ownerLabel}`,
      "┃ *sᴛᴀᴛᴜs* : Online ✅",
      `┃ *ᴍᴏᴅᴇ* : ${mode}`,
      "╰━━━━━━━━━━━━━━━━━━━━╯",
    ].join("\n");

    const mentions = [userJid, ownerJid].filter(Boolean);
    await sock.sendMessage(jid, { text, mentions }, { quoted: message });
  },
};
