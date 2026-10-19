"use strict";

module.exports = {
  name: "demote",
  aliases: [],
  description: "Demote a group admin",
  async execute({ sock, jid, message }) {
    if (!jid.endsWith("@g.us")) {
      await sock.sendMessage(jid, { text: "❌ This command works in groups only." }, { quoted: message });
      return;
    }

    const metadata = await sock.groupMetadata(jid);
    const sender = message.key?.participant || message.key?.remoteJid;
    const senderInfo = metadata.participants.find((p) => p.id === sender);
    const botNumber = sock.user?.id?.split(":")[0];
    const botInfo = metadata.participants.find((p) => p.id === sock.user?.id || p.id?.startsWith(botNumber + ":"));
    if (senderInfo?.admin !== "admin" && senderInfo?.admin !== "superadmin") {
      await sock.sendMessage(jid, { text: "❌ Only group admins can use this command." }, { quoted: message });
      return;
    }
    if (botInfo?.admin !== "admin" && botInfo?.admin !== "superadmin") {
      await sock.sendMessage(jid, { text: "❌ Make the bot a group admin first." }, { quoted: message });
      return;
    }

    const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    if (!target) {
      await sock.sendMessage(jid, { text: "Usage: .demote @member" }, { quoted: message });
      return;
    }
    const targetInfo = metadata.participants.find((p) => p.id === target || p.id?.startsWith(target.split("@")[0] + ":"));
    if (!targetInfo) {
      await sock.sendMessage(jid, { text: "❌ Admin not found in this group." }, { quoted: message });
      return;
    }
    if (!targetInfo.admin) {
      await sock.sendMessage(jid, { text: "ℹ️ That member is not an admin." }, { quoted: message });
      return;
    }
    if (targetInfo.admin === "superadmin") {
      await sock.sendMessage(jid, { text: "❌ The group owner cannot be demoted." }, { quoted: message });
      return;
    }

    await sock.groupParticipantsUpdate(jid, [targetInfo.id], "demote");
    await sock.sendMessage(jid, { text: "✅ Admin demoted to member." }, { quoted: message });
  },
};
