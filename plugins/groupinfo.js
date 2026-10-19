"use strict";

module.exports = {
  name: "groupinfo",
  aliases: ["ginfo"],
  description: "Show current group information",
  async execute({ sock, jid, message }) {
    if (!jid.endsWith("@g.us")) {
      await sock.sendMessage(jid, { text: "❌ This command works in groups only." }, { quoted: message });
      return;
    }

    const metadata = await sock.groupMetadata(jid);
    const participants = metadata.participants || [];
    const admins = participants.filter((p) => p.admin === "admin" || p.admin === "superadmin").length;
    const text = `╭━━〔 *GROUP INFO* 〕━━╮
┃ 🏷️ Name: ${metadata.subject || "Unknown"}
┃ 🆔 Members: ${participants.length}
┃ 👑 Admins: ${admins}
┃ 📝 Description: ${metadata.desc || "Not set"}
╰━━━━━━━━━━━━━━━━━━╯`;
    await sock.sendMessage(jid, { text }, { quoted: message });
  },
};
