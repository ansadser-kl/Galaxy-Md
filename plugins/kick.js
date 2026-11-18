"use strict";

const digits = (v) => String(v || "").split("@")[0].split(":")[0].replace(/\D/g, "");

function unwrap(message) {
  let m = message || {};
  for (let i = 0; i < 6; i++) {
    const next =
      m.ephemeralMessage?.message ||
      m.viewOnceMessage?.message ||
      m.viewOnceMessageV2?.message ||
      m.documentWithCaptionMessage?.message;
    if (!next) break;
    m = next;
  }
  return m;
}

function getContexts(message) {
  const m = unwrap(message?.message);
  return [
    m.extendedTextMessage?.contextInfo,
    m.imageMessage?.contextInfo,
    m.videoMessage?.contextInfo,
    m.audioMessage?.contextInfo,
    m.documentMessage?.contextInfo,
    m.stickerMessage?.contextInfo,
  ].filter(Boolean);
}

// Participant-ine match cheyyaan: id, lid, phoneNumber, allenkil number digits
function findMember(participants, target) {
  const t = String(target || "");
  const tDigits = digits(t);
  if (!t) return null;
  return (
    participants.find((p) => p.id === t || p.lid === t || p.phoneNumber === t) ||
    participants.find((p) =>
      [p.id, p.lid, p.phoneNumber].some((x) => x && digits(x) && digits(x) === tDigits)
    ) ||
    null
  );
}

module.exports = {
  name: "kick",
  aliases: ["remove"],
  description: "Remove a member by replying to them or mentioning them (admins only)",
  category: "Group",

  async execute({ sock, jid, message }) {
    const send = (text) => sock.sendMessage(jid, { text }, { quoted: message });

    if (!jid.endsWith("@g.us")) return send("This command works in groups only.");

    // 1. Mention aano, allenkil reply cheytha aalude id
    const contexts = getContexts(message);
    const mentioned = contexts.flatMap((c) => c.mentionedJid || []);
    const replied = contexts.map((c) => c.participant).find(Boolean);
    const target = mentioned[0] || replied;

    if (!target) return send("Oralude message-ilekku reply cheythu .kick ayakkuka, allenkil @mention cheyyuka.");

    try {
      const metadata = await sock.groupMetadata(jid);
      const participants = metadata?.participants || [];

      // 2. Command ayachayaal (sender) admin aano
      const senderId = message.key?.participant || message.key?.participantAlt || "";
      const sender = findMember(participants, senderId);
      const isAdmin = sender?.admin || sender?.superadmin;
      if (!message.key?.fromMe && !isAdmin) {
        return send("Group admins mathram aanu .kick use cheyyaan pattuka.");
      }

      // 3. Bot admin aano
      const botNum = digits(sock.user?.id);
      const bot = participants.find((p) =>
        p.id === sock.user?.id || p.lid === sock.user?.lid || digits(p.id) === botNum || digits(p.lid) === botNum
      );
      if (!bot?.admin && !bot?.superadmin) {
        return send("Bot-ine group admin aakkuka, appol mathram kick cheyyaan pattum.");
      }

      // 4. Target participant
      const member = findMember(participants, target);
      if (!member) return send("Ee member group-il kandilla.");
      if (member.superadmin) return send("Group owner-ine remove cheyyaan pattilla.");

      // 5. Remove (id-yo lid-yo, Baileys version-nu anusarichu)
      const removeId = member.id || member.lid;
      await sock.groupParticipantsUpdate(jid, [removeId], "remove");
      return send("Member remove cheythu.");
    } catch (error) {
      console.error("[GALAXY-MD] Kick failed:", error?.stack || error?.message || error);
      return send("Kick failed: " + String(error?.message || "unknown error").slice(0, 200));
    }
  },
};
