"use strict";

const config = require("../config");

module.exports = {
  name: "owner",
  aliases: ["creator"],
  description: "Send bot owner contact card",
  async execute({ sock, jid, message }) {
    const number = String(config.ownerNumber || "").replace(/\D/g, "");
    if (!number) {
      await sock.sendMessage(jid, { text: "Owner number is not configured." }, { quoted: message });
      return;
    }

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
  },
};
