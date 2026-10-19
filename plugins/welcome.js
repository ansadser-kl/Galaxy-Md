"use strict";

const fs = require("fs");
const path = require("path");
const DATA = path.join(__dirname, "..", "galaxy-data.json");

function readData() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); } catch { return {}; }
}
function writeData(data) {
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + "\n");
}
async function isGroupAdmin(sock, jid, sender) {
  if (!jid.endsWith("@g.us")) return false;
  const metadata = await sock.groupMetadata(jid).catch(() => null);
  const participant = metadata?.participants?.find(p =>
    p.id === sender || p.lid === sender ||
    String(p.id || "").split(":")[0] === String(sender || "").split(":")[0]
  );
  return !!(participant?.admin || participant?.superadmin);
}
function getSender(message) {
  return message.key?.participant || message.key?.participantAlt || message.key?.remoteJid || "";
}
async function renderMessage(sock, groupJid, template, userJid) {
  const metadata = await sock.groupMetadata(groupJid).catch(() => ({}));
  const number = String(userJid || "").split("@")[0].split(":")[0];
  const values = {
    "$mention": number ? "@" + number : "member",
    "$user": number || "member",
    "$group": String(metadata.subject || "this group").replace(/[\r\n]+/g, " "),
    "$count": String(metadata.participants?.length || 0),
    "$desc": String(metadata.desc || "No description").replace(/[\r\n]+/g, " "),
    "$date": new Date().toLocaleDateString(),
    "$time": new Date().toLocaleTimeString()
  };
  for (const key of Object.keys(values)) template = template.split(key).join(values[key]);
  const mentions = userJid ? [userJid] : [];
  try {
    const pp = await sock.profilePictureUrl(userJid, "image");
    template = template.split("$pp").join(pp);
  } catch { template = template.split("$pp").join(""); }
  try {
    const gpp = await sock.profilePictureUrl(groupJid, "image");
    template = template.split("$gpp").join(gpp);
  } catch { template = template.split("$gpp").join(""); }
  return { text: template, mentions };
}

module.exports = {
  name: "welcome",
  aliases: ["goodbye", "testwelcome", "testgoodbye"],
  description: "Configure group welcome and goodbye messages",
  async execute({ sock, jid, message, query, command, isPrivileged }) {
    const reply = text => sock.sendMessage(jid, { text }, { quoted: message });
    if (!jid.endsWith("@g.us")) return reply("❌ This command works in groups only.");
    const sender = getSender(message);
    if (!isPrivileged && !(await isGroupAdmin(sock, jid, sender))) {
      return reply("⛔ Only group admins or bot owner/SUDO can use this command.");
    }
    const type = command === "goodbye" || command === "testgoodbye" ? "goodbye" : "welcome";
    const data = readData();
    data.groupMessages ||= {};
    data.groupMessages[jid] ||= {};
    const entry = data.groupMessages[jid];
    const input = String(query || "").trim();
    const action = (input.split(/\s+/)[0] || "").toLowerCase();

    if (command === "testwelcome" || command === "testgoodbye") {
      const item = entry[type];
      if (!item?.message) return reply("❌ Set a message first: ." + type + " <message>");
      if (item.enabled === false) return reply("⚠️ " + type + " is disabled. Use ." + type + " on first.");
      return sock.sendMessage(jid, await renderMessage(sock, jid, item.message, sender), { quoted: message });
    }
    if (action === "help") return reply(
      "*Welcome / Goodbye commands*\n" +
      "• .welcome <message> — set welcome text\n• .welcome on/off — enable/disable\n• .welcome get — view text\n• .welcome del — delete\n" +
      "• .goodbye <message> — set goodbye text\n• .goodbye on/off/get/del — manage goodbye\n• .testwelcome / .testgoodbye — test\n\n" +
      "Placeholders: $mention, $user, $group, $count, $desc, $date, $time, $pp, $gpp"
    );
    if (action === "status") {
      const w = entry.welcome, g = entry.goodbye;
      return reply("*Group message status*\nWelcome: " + (w?.enabled ? "ON" : "OFF") +
        (w?.message ? "\nText: " + w.message : "\nNot set") +
        "\nGoodbye: " + (g?.enabled ? "ON" : "OFF") +
        (g?.message ? "\nText: " + g.message : "\nNot set"));
    }
    if (action === "get") {
      const item = entry[type];
      return reply(item?.message ? "*" + type + " message* (" + (item.enabled ? "ON" : "OFF") + ")\n" + item.message : "❌ No " + type + " message set.");
    }
    if (action === "del" || action === "delete") {
      if (!entry[type]) return reply("ℹ️ No " + type + " message is set.");
      delete entry[type]; writeData(data);
      return reply("🗑️ " + type + " message deleted.");
    }
    if (action === "on" || action === "off") {
      if (!entry[type]?.message) return reply("❌ Set a message first: ." + type + " <message>");
      entry[type].enabled = action === "on"; writeData(data);
      return reply("✅ " + type + " messages " + (action === "on" ? "enabled." : "disabled."));
    }
    if (!input) return reply("Usage: ." + type + " <message> | on | off | get | del | help");
    if (input.length > 2000) return reply("❌ Message must be 2000 characters or fewer.");
    entry[type] = { message: input, enabled: true };
    writeData(data);
    return reply("✅ " + type + " message saved and enabled.\n\nPreview:\n" + input);
  }
};
