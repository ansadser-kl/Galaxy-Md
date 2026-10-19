"use strict";

module.exports = {
  name: "demote",
  aliases: [],
  description: "Demote a group admin",
  async execute({ sock, jid, message }) {
    const send = (text) => sock.sendMessage(jid, { text }, { quoted: message });
    if (!jid.endsWith("@g.us")) return send("❌ This command works in groups only.");

    try {
      const metadata = await sock.groupMetadata(jid);
      const sameJid = (a, b) => !!a && !!b && (
        a === b ||
        String(a).split("@")[0].split(":")[0] === String(b).split("@")[0].split(":")[0]
      );
      const sender = message.key?.participant || message.key?.participantAlt || message.key?.remoteJid;
      const senderInfo = metadata.participants.find((p) => sameJid(p.id, sender) || sameJid(p.lid, sender));
      const botInfo = metadata.participants.find((p) =>
        sameJid(p.id, sock.user?.id) || sameJid(p.lid, sock.user?.lid) ||
        sameJid(p.id, (sock.user?.id || "").split(":")[0] + "@s.whatsapp.net")
      );
      if (!senderInfo?.admin && !senderInfo?.superadmin && !message.key?.fromMe) return send("❌ Only group admins can use this command.");
      if (!botInfo?.admin && !botInfo?.superadmin) return send("❌ Make the bot a group admin first.");

      const context = message.message?.extendedTextMessage?.contextInfo;
      const target = context?.mentionedJid?.[0] || context?.participant || context?.participantAlt;
      if (!target) return send("Usage: mention an admin or reply to their message with .demote");
      const member = metadata.participants.find((p) => sameJid(p.id, target) || sameJid(p.lid, target));
      if (!member) return send("❌ Member not found in this group.");
      if (!member.admin && !member.superadmin) return send("ℹ️ That member is not an admin.");
      if (member.superadmin) return send("❌ The group owner cannot be demoted.");

      await sock.groupParticipantsUpdate(jid, [member.id], "demote");
      return send("✅ Admin demoted to member.");
    } catch (error) {
      console.error("[GALAXY-MD] Demote failed:", error.message || error);
      return send("❌ Demote failed. Check that the bot is a group admin and try again.");
    }
  },
};
