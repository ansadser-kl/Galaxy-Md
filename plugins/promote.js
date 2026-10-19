"use strict";

module.exports = {
  name: "promote",
  aliases: [],
  description: "Promote a member to admin (admins only)",
  async execute({ sock, jid, message }) {
    const send = (text) => sock.sendMessage(jid, { text }, { quoted: message });
    if (!jid.endsWith("@g.us")) return send("❌ Groups only.");

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
      if (!target) return send("Usage: mention a member or reply to their message with .promote");
      const member = metadata.participants.find((p) => sameJid(p.id, target) || sameJid(p.lid, target));
      if (!member) return send("❌ Member not found.");
      if (member.admin || member.superadmin) return send("ℹ️ That member is already an admin.");

      await sock.groupParticipantsUpdate(jid, [member.id], "promote");
      return send("✅ Member promoted to admin.");
    } catch (error) {
      console.error("[GALAXY-MD] Promote failed:", error.message || error);
      return send("❌ Promote failed. Check that the bot is a group admin and try again.");
    }
  },
};
