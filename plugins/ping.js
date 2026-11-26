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
    const finalText = `*Speed* *${ms}* *ms*`;

    if (sent?.key?.id) {
      try {
        await sock.sendMessage(jid, {
          text: finalText,
          edit: sent.key,
        });
      } catch {
        await sock.sendMessage(
          jid,
          { text: finalText },
          { quoted: message }
        );
      }
    }
  },
};
