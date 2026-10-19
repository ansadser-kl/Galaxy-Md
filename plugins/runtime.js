"use strict";

const config = require("../config");

function formatDuration(totalSeconds) {
  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor((totalSeconds / 60) % 60);
  const hours = Math.floor((totalSeconds / 3600) % 24);
  const days = Math.floor(totalSeconds / 86400);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

module.exports = {
  name: "runtime",
  aliases: ["uptime"],
  description: "Show bot uptime",
  async execute({ sock, jid, message }) {
    const uptime = formatDuration(process.uptime());
    const text = `╭━━〔 *${config.botName}* 〕━━╮
┃ ⏱️ Uptime: ${uptime}
┃ ⚙️ Version: ${config.version}
┃ ✅ Status: Running
╰━━━━━━━━━━━━━━━━━━╯`;
    await sock.sendMessage(jid, { text }, { quoted: message });
  },
};
