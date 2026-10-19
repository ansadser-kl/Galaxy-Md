"use strict";

const fs = require("fs");
const path = require("path");

const DATA = path.join(__dirname, "..", "galaxy-data.json");
function readData() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); } catch { return {}; }
}
function writeData(data) { fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + "\n"); }
function save(data) { writeData(data); }
function isAdmin(metadata, jid) {
  const p = metadata.participants.find(x => x.id === jid || x.lid === jid || x.id?.split(":")[0] === jid?.split(":")[0]);
  return !!(p?.admin || p?.superadmin);
}
function getTarget(message) {
  const c = message.message?.extendedTextMessage?.contextInfo;
  return c?.mentionedJid?.[0] || c?.participant || c?.participantAlt;
}

module.exports = {
  name: "info",
  aliases: [
    "admins", "getjids", "setprefix", "antilink", "antiviewonce",
    "autoreply", "setcmd", "getcmd",
    "delcmd", "setvideo", "setimage", "setbot", "setowner", "setsudo", "getsudo",
    "delsudo", "resetsession", "reboot", "forward", "send", "vn", "url"
  ],
  description: "GALAXY-MD utility, moderation and owner controls",
  async execute({ sock, jid, message, query, command, config, isPrivileged, args, plugins }) {
    const data = readData();
    const reply = (text, extra = {}) => sock.sendMessage(jid, { text, ...extra }, { quoted: message });
    const ownerOnly = ["setprefix", "setcmd", "getcmd", "delcmd", "setvideo", "setimage", "setbot", "setowner", "setsudo", "getsudo", "delsudo", "resetsession", "reboot"].includes(command);
    if (ownerOnly && !isPrivileged) return reply("⛔ Owner/SUDO only.");

    if (command === "info") {
      return reply("🤖 *GALAXY-MD*\n" + "Version: " + config.version + "\nMode: " + config.mode + "\nPrefix: " + config.prefix + "\nPlugins loaded: " + (plugins?.length ?? "dynamic"));
    }
    if (command === "admins") {
      if (!jid.endsWith("@g.us")) return reply("Group only.");
      const m = await sock.groupMetadata(jid);
      const admins = m.participants.filter(p => p.admin || p.superadmin);
      return reply("👥 *Group admins*\n" + admins.map(p => "• @" + (p.id || "").split("@")[0].split(":")[0]).join("\n"), { mentions: admins.map(p => p.id) });
    }
    if (command === "getjids") {
      if (!jid.endsWith("@g.us")) return reply("Group only.");
      const m = await sock.groupMetadata(jid);
      return reply("Group: " + jid + "\n" + m.participants.map(p => p.id).join("\n"));
    }
    if (command === "setprefix") {
      const p = String(query || "").trim();
      if (!p || p.length > 3 || /\s/.test(p)) return reply("Usage: .setprefix <1-3 characters>");
      data.prefix = p; config.prefix = p; save(data);
      return reply("Prefix changed to: " + p);
    }
    if (["welcome", "antilink", "antiviewonce", "autoreply"].includes(command)) {
      if (!jid.endsWith("@g.us") && command !== "autoreply") return reply("This command works in groups only.");
      if (!isPrivileged) {
        const m = await sock.groupMetadata(jid).catch(() => null);
        const sender = message.key?.participant || message.key?.remoteJid;
        if (!m || !isAdmin(m, sender)) return reply("Only group admins or bot owner can change this setting.");
      }
      const value = String(query || "").trim().toLowerCase();
      if (!["on", "off", "status"].includes(value)) return reply("Usage: ." + command + " on/off/status");
      data.features ||= {};
      data.features[jid + ":" + command] ||= false;
      if (value !== "status") data.features[jid + ":" + command] = value === "on";
      save(data);
      return reply("⚙️ " + command + ": " + (data.features[jid + ":" + command] ? "ON" : "OFF"));
    }
    if (command === "setcmd") {
      const [key, ...body] = String(query || "").split("|");
      if (!key?.trim() || !body.join("|").trim()) return reply("Usage: .setcmd name|response text");
      data.customCommands ||= {};
      data.customCommands[key.trim().toLowerCase()] = body.join("|").trim(); save(data);
      return reply("✅ Custom command saved: " + key.trim());
    }
    if (command === "getcmd") {
      const key = String(query || "").trim().toLowerCase();
      data.customCommands ||= {};
      if (key) return reply(data.customCommands[key] ? key + " → " + data.customCommands[key] : "Custom command not found.");
      return reply("Custom commands:\n" + (Object.keys(data.customCommands).join(", ") || "None"));
    }
    if (command === "delcmd") {
      const key = String(query || "").trim().toLowerCase();
      data.customCommands ||= {};
      if (!data.customCommands[key]) return reply("Custom command not found.");
      delete data.customCommands[key]; save(data); return reply("🗑️ Deleted: " + key);
    }
    if (command === "setbot") {
      if (!query.trim()) return reply("Usage: .setbot <new bot name>");
      data.botName = query.trim().slice(0, 40); config.botName = data.botName; save(data); return reply("Bot display name saved.");
    }
    if (command === "setowner") {
      const n = String(query || "").replace(/\D/g, "");
      if (n.length < 8) return reply("Usage: .setowner <number with country code>");
      data.ownerNumber = n; config.ownerNumber = n; save(data); return reply("Owner number saved.");
    }
    if (command === "setsudo") {
      const n = String(query || "").replace(/\D/g, "");
      if (n.length < 8) return reply("Usage: .setsudo <number with country code>");
      data.sudo ||= []; if (!data.sudo.includes(n)) data.sudo.push(n); config.sudoNumbers = [...new Set([...(config.sudoNumbers || []), n])]; save(data); return reply("SUDO added: " + n);
    }
    if (command === "getsudo") return reply("SUDO numbers:\n" + ((data.sudo || config.sudoNumbers || []).join("\n") || "None"));
    if (command === "delsudo") {
      const n = String(query || "").replace(/\D/g, "");
      data.sudo = (data.sudo || []).filter(x => x !== n); config.sudoNumbers = (config.sudoNumbers || []).filter(x => x !== n); save(data); return reply("SUDO removed if it was present.");
    }
    if (command === "setvideo" || command === "setimage") {
      if (!query.trim()) return reply("Usage: ." + command + " <URL>");
      if (!/^https?:\/\//i.test(query.trim())) return reply("Please provide a valid http(s) URL.");
      data[command] = query.trim(); save(data); return reply(command + " URL saved.");
    }
    if (command === "resetsession") return reply("⚠️ For safety, session reset is not available as a chat command. Stop the bot and back up the session folder before resetting it manually.");
    if (command === "reboot") {
      await reply("♻️ Restarting bot process...");
      setTimeout(() => process.exit(0), 1000);
      return;
    }
    if (command === "send") {
      if (!isPrivileged) return reply("Owner/SUDO only.");
      const [number, ...textParts] = String(query || "").split("|");
      const target = (number || "").replace(/\D/g, "");
      const body = textParts.join("|").trim();
      if (target.length < 8 || !body) return reply("Usage: .send number|message");
      await sock.sendMessage(target + "@s.whatsapp.net", { text: body });
      return reply("Message sent.");
    }
    if (command === "forward") {
      const c = message.message?.extendedTextMessage?.contextInfo;
      if (!c?.quotedMessage) return reply("Reply to a message with .forward number");
      const n = String(query || "").replace(/\D/g, "");
      if (n.length < 8) return reply("Usage: reply to message, then .forward number");
      const quoted = c.quotedMessage;
      const text = quoted.conversation || quoted.extendedTextMessage?.text || quoted.imageMessage?.caption || quoted.videoMessage?.caption;
      if (!text) return reply("Currently forwarding text messages only.");
      await sock.sendMessage(n + "@s.whatsapp.net", { text });
      return reply("Text forwarded.");
    }
    if (command === "vn") {
      const context = message.message?.extendedTextMessage?.contextInfo;
      const quoted = context?.quotedMessage;
      const audio = quoted?.audioMessage || message.message?.audioMessage;
      if (!audio) return reply("🎙️ Reply to an MP3/audio file with .vn");
      const { downloadMediaMessage } = require("baileys");
      const os = require("os");
      const { execFile } = require("child_process");
      const { promisify } = require("util");
      const execFileAsync = promisify(execFile);
      const base = path.join(os.tmpdir(), "galaxy-vn-" + Date.now());
      const input = base + ".audio";
      const output = base + ".ogg";
      const source = quoted ? { key: { remoteJid: jid, id: context.stanzaId, participant: context.participant, participantAlt: context.participantAlt }, message: quoted } : message;
      try {
        fs.writeFileSync(input, await downloadMediaMessage(source, "buffer", {}));
        await execFileAsync("ffmpeg", ["-y", "-i", input, "-vn", "-c:a", "libopus", "-b:a", "32k", "-ar", "48000", "-ac", "1", "-f", "ogg", output], { timeout: 120000 });
        await sock.sendMessage(jid, { audio: fs.readFileSync(output), mimetype: "audio/ogg; codecs=opus", ptt: true }, { quoted: message });
      } catch (error) {
        console.error("[GALAXY-MD] Voice note conversion failed:", error.message || error);
        await reply("❌ Voice note conversion failed. Check FFmpeg is installed (Ubuntu: sudo apt install ffmpeg; Termux: pkg install ffmpeg).");
      } finally {
        for (const file of [input, output]) try { fs.unlinkSync(file); } catch {}
      }
      return;
    }
    if (command === "url") return reply("The .url upload command will be added with the downloader commands, as requested.");
  }
};
