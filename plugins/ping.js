"use strict";

module.exports = {
  name: "ping",
  aliases: [],
  description: "Check bot response",
  async execute({ sock, jid, message }) {
    await sock.sendMessage(jid, { text: "🏓 PONG!" }, { quoted: message });
  },
};
