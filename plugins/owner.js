"use strict";

const config = require("../config");

module.exports = {
  name: "owner",
  aliases: ["creator"],
  description: "Show bot owner contact",
  async execute({ sock, jid, message }) {
    const number = String(config.ownerNumber || "").replace(/\D/g, "");
    if (!number) {
      await sock.sendMessage(
        jid,
        { text: "⚠️ Owner number is not configured. Set OWNER_NUMBER in .env." },
        { quoted: message }
      );
      return;
    }

    const ownerJid = `${number}@s.whatsapp.net`;
    await sock.sendMessage(
      jid,
      {
        contacts: {
          displayName: "GALAXY-MD Owner",
          contacts: [{
            displayName: "GALAXY-MD Owner",
            vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:GALAXY-MD Owner\nTEL;type=CELL;type=VOICE;waid=${number}:+${number}\nEND:VCARD`,
          }],
        },
      },
      { quoted: message }
    );
    await sock.sendMessage(jid, { text: `👑 *GALAXY-MD Owner*\nWhatsApp: @${number}`, mentions: [ownerJid] }, { quoted: message });
  },
};
