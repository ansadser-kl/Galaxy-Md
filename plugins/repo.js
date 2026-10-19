"use strict";
module.exports = {
  name: "repo",
  aliases: ["github"],
  description: "Show the GALAXY-MD source repository",
  category: "Utility",
  async execute({ sock, jid, message }) {
    await sock.sendMessage(jid, { text: "🌌 *GALAXY-MD Repository*\nhttps://github.com/ansadser-kl/Galaxy-Md" }, { quoted: message });
  }
};
