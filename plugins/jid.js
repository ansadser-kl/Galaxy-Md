"use strict";

module.exports = {
  name: "jid",
  aliases: [],
  description: "Show the current chat JID",
  async execute({ sock, jid, message }) {
    const chatJid = jid || message?.key?.remoteJid || "Unavailable";
    await sock.sendMessage(chatJid, { text: chatJid }, { quoted: message });
  },
};
