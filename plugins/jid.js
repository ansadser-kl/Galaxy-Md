"use strict";

module.exports = {
  name: "jid",
  aliases: [],
  description: "Show chat JID and your participant/LID ID",
  async execute({ sock, jid, message }) {
    const chatJid = jid || message?.key?.remoteJid || "Unavailable";
    const participantId =
      message?.key?.participant ||
      message?.key?.participantAlt ||
      message?.key?.remoteJid ||
      "Unavailable";

    const text = [
      "╭━━━〔 🌌 *GALAXY-MD JID* 〕━━━╮",
      `┃ 💬 *Chat JID:* ${chatJid}`,
      `┃ 👤 *Your LID / Participant ID:* ${participantId}`,
      "╰━━━━━━━━━━━━━━━━━━━━╯",
    ].join("\n");

    await sock.sendMessage(chatJid, { text }, { quoted: message });
  },
};
