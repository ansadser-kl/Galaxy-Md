"use strict";

const config = require("../config");

module.exports = {
  name: "echo",
  aliases: [],
  description: "Repeat text",
  async execute({ sock, jid, message, query }) {
    await sock.sendMessage(
      jid,
      { text: query || `Usage: ${config.prefix}echo your text` },
      { quoted: message }
    );
  },
};
