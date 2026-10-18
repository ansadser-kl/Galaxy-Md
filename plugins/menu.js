"use strict";

const config = require("../config");

module.exports = {
  name: "menu",
  aliases: ["help"],
  description: "Show available commands",
  async execute({ sock, jid, message, plugins }) {
    const lines = [
      `╭━━〔 *${config.botName}* 〕━━╮`,
      "┃",
      ...plugins.map((plugin) => `┃  ${config.prefix}${plugin.name} — ${plugin.description || "Command"}`),
      "┃",
      `╰━━━━━━━━━━━━━━━━━━╯`,
    ];
    await sock.sendMessage(jid, { text: lines.join("\n") }, { quoted: message });
  },
};
