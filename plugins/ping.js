"use strict";

module.exports = {
  name: "ping",
  aliases: [],
  description: "Check bot response speed",
  async execute({ sock, jid, message, receivedAt }) {
    const start = Number(receivedAt) || Date.now();
    const ms = Math.max(0, Date.now() - start);
    await sock.sendMessage(
      jid,
      { text: `*Latency* ${ms} ms` },
      { quoted: message }
    );
  },
};
