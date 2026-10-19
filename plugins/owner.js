"use strict";

const config = require("../config");

module.exports = {
  name: "owner",
  aliases: ["creator"],
  description: "Show bot owner number only",
  async execute({ sock, jid, message }) {
    const number = String(config.ownerNumber || "").replace(/\D/g, "");
    if (!number) {
      await sock.sendMessage(jid, { text: "Owner number is not configured." }, { quoted: message });
      return;
    }

    await sock.sendMessage(jid, { text: number });
  },
};
