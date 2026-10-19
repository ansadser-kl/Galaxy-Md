"use strict";

module.exports = {
  name: "ping",
  aliases: [],
  description: "Check bot response speed",
  async execute({ sock, jid, message }) {
    const start = Date.now();
    const sent = await sock.sendMessage(
      jid,
      { text: "Pinging..." },
      { quoted: message }
    );
    const ms = Math.max(0, Date.now() - start);

    if (sent?.key?.id) {
      await sock.sendMessage(jid, {
        text: `*Latency* *${ms}* *ms*`,
        edit: sent.key,
      });
    }
  },
};
