"use strict";

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const YTDLP = process.env.YTDLP_PATH || "yt-dlp";
const COOKIES = process.env.YTDLP_COOKIES || path.join(process.cwd(), "cookies.txt");

const LOGIN_COOKIES = ["SID", "HSID", "SSID", "APISID", "SAPISID", "__Secure-1PSID", "__Secure-3PSID", "LOGIN_INFO"];

function getVersion() {
  return new Promise((resolve) => {
    execFile(YTDLP, ["--version"], { timeout: 15000 }, (error, stdout) => {
      resolve(error ? null : String(stdout).trim());
    });
  });
}

function senderId(message, jid) {
  return message.key?.participant || message.key?.participantAlt || jid;
}

module.exports = {
  name: "ytcheck",
  aliases: [],
  description: "Check yt-dlp and cookies status (owner only)",
  category: "Owner",

  async execute({ sock, jid, message }) {
    const OWNERS = (process.env.OWNER_NUMBER || "").split(",").map(s => s.replace(/\D/g, "")).filter(Boolean);
    const id = String(senderId(message, jid)).split("@")[0].split(":")[0].replace(/\D/g, "");
    if (!message.key?.fromMe && !OWNERS.includes(id)) {
      return sock.sendMessage(jid, { text: "❌ ഉടമയ്ക്ക് മാത്രം." }, { quoted: message });
    }

    const lines = [];

    const version = await getVersion();
    lines.push(version ? "✅ yt-dlp: " + version : "❌ yt-dlp കണ്ടെത്താനായില്ല");

    lines.push("📁 Cookies path: " + COOKIES);

    if (!fs.existsSync(COOKIES)) {
      lines.push("❌ cookies ഫയൽ ഇല്ല. .setcookies ചെയ്യുക.");
    } else {
      const stat = fs.statSync(COOKIES);
      const content = fs.readFileSync(COOKIES, "utf8");
      const rows = content.split("\n").map(l => l.replace(/^#HttpOnly_/, "").trim())
        .filter(l => l && !l.startsWith("#"))
        .map(l => l.split("\t"))
        .filter(p => p.length >= 7);

      const yt = rows.filter(p => /youtube\.com|google\.com/i.test(p[0]));
      const names = new Set(yt.map(p => p[5]));
      const found = LOGIN_COOKIES.filter(n => names.has(n));
      const now = Math.floor(Date.now() / 1000);
      const expired = yt.filter(p => Number(p[4]) > 0 && Number(p[4]) < now && LOGIN_COOKIES.includes(p[5]));

      lines.push("📦 വലുപ്പം: " + stat.size + " bytes");
      lines.push("🍪 ആകെ cookies: " + rows.length + " (YouTube/Google: " + yt.length + ")");
      lines.push(found.length >= 3
        ? "✅ ലോഗിൻ cookies ഉണ്ട്: " + found.join(", ")
        : "❌ ലോഗിൻ cookies ഇല്ല/കുറവാണ്. ലോഗിൻ ചെയ്ത ശേഷം export ചെയ്തോ?");
      if (expired.length) lines.push("⚠️ " + expired.length + " ലോഗിൻ cookies expire ആയി");
      lines.push("🕒 അവസാനം മാറ്റിയത്: " + stat.mtime.toLocaleString());
    }

    await sock.sendMessage(jid, { text: lines.join("\n") }, { quoted: message });
  }
};
