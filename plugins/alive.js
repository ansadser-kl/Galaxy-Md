"use strict";

const config = require("../config");

module.exports = {
  name: "alive",
  aliases: [],
  description: "Show bot status",
  async execute({ sock, jid, message }) {
    const text = `╭━━〔 *${config.botName}* 〕━━╮
┃ Status: Online ✅
┃ Prefix: ${config.prefix}
┃ Version: ${config.version}
╰━━━━━━━━━━━━━━━━━━╯`;
    await sock.sendMessage(jid, { text }, { quoted: message });
  },
};
