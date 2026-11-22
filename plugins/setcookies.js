"use strict";

const fs = require("fs");
const path = require("path");

// ytv.js ഉപയോഗിക്കുന്ന അതേ path
const COOKIES = process.env.YTDLP_COOKIES || path.join(process.cwd(), "cookies.txt");

// ഉടമയുടെ നമ്പർ (country code സഹിതം, + ഇല്ലാതെ). ഒന്നിൽ കൂടുതലെങ്കിൽ comma ഇട്ട്.
// ഉദാ: OWNER_NUMBER=919876543210
const OWNERS = (process.env.OWNER_NUMBER || "")
  .split(",")
  .map(s => s.replace(/\D/g, ""))
  .filter(Boolean);

function senderId(message, jid) {
  return message.key?.participant || message.key?.participantAlt || jid;
}

function isOwner(message, jid) {
  if (message.key?.fromMe) return true;
  const id = String(senderId(message, jid)).split("@")[0].split(":")[0].replace(/\D/g, "");
  return OWNERS.includes(id);
}

function getQuotedText(message) {
  const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  return quoted?.conversation || quoted?.extendedTextMessage?.text || "";
}

// WhatsApp paste ചെയ്യുമ്പോൾ tab ഒക്കെ space ആയി മാറും, അത് ശരിയാക്കുന്നു
function normalizeCookies(raw) {
  const out = ["# Netscape HTTP Cookie File"];
  let count = 0;
  let youtube = false;

  for (const rawLine of String(raw).replace(/\r/g, "").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#") && !line.startsWith("#HttpOnly_")) continue;

    const parts = line.split(/\s+/);
    if (parts.length < 7) continue;

    const fields = parts.slice(0, 6);
    fields.push(parts.slice(6).join(" "));

    if (!/^(TRUE|FALSE)$/i.test(fields[1]) || !/^(TRUE|FALSE)$/i.test(fields[3])) continue;
    if (!/^\d+$/.test(fields[4])) continue;

    fields[1] = fields[1].toUpperCase();
    fields[3] = fields[3].toUpperCase();

    if (/youtube\.com|google\.com/i.test(fields[0])) youtube = true;
    out.push(fields.join("\t"));
    count++;
  }

  return { content: out.join("\n") + "\n", count, youtube };
}

module.exports = {
  name: "setcookies",
  aliases: ["setcookie"],
  description: "Save YouTube cookies for yt-dlp (owner only)",
  category: "Owner",

  async execute({ sock, jid, message, text, args }) {
    const reply = (t) => sock.sendMessage(jid, { text: t }, { quoted: message });

    if (!isOwner(message, jid)) {
      return reply("❌ ഇത് ഉടമയ്ക്ക് മാത്രമുള്ള കമാൻഡ് ആണ്.");
    }

    const raw = getQuotedText(message) || String(text || args?.join("\n") || "");
    if (!raw.trim()) {
      return reply(
        "📋 cookies ടെക്സ്റ്റ് അയച്ച ശേഷം അതിന് റിപ്ലൈ ആയി .setcookies അടിക്കുക.\n" +
        "(അല്ലെങ്കിൽ .setcookies ന്റെ കൂടെ തന്നെ paste ചെയ്യുക)"
      );
    }

    try {
      const { content, count, youtube } = normalizeCookies(raw);

      if (!count) {
        return reply("❌ സാധുവായ cookies കണ്ടെത്താനായില്ല. Netscape format (cookies.txt) ആണോ എന്ന് നോക്കൂ.");
      }

      fs.mkdirSync(path.dirname(COOKIES), { recursive: true });
      fs.writeFileSync(COOKIES, content, { mode: 0o600 });

      await reply(
        "✅ Cookies സേവ് ചെയ്തു!\n" +
        "🍪 എണ്ണം: " + count + "\n" +
        (youtube ? "" : "⚠️ YouTube/Google cookies കണ്ടില്ല, ശരിയായ ഫയൽ ആണോ?\n") +
        "ഇനി .ytv ഉപയോഗിച്ച് നോക്കാം."
      );
    } catch (error) {
      console.error("[GALAXY-MD] .setcookies error:", error);
      await reply("❌ സേവ് ചെയ്യാൻ പറ്റിയില്ല: " + String(error.message || "error").slice(0, 150));
    }
  }
};
