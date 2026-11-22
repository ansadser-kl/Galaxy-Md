"use strict";

const fs = require("fs");
const path = require("path");
const { downloadContentFromMessage } = require("@whiskeysockets/baileys");

const COOKIES_FILE = path.join(process.cwd(), "cookies.txt");

function extractCookiesDocumentMessage(message) {
  const direct = message?.message;
  if (direct?.documentMessage) return direct.documentMessage;
  if (direct?.documentWithCaptionMessage?.message?.documentMessage) {
    return direct.documentWithCaptionMessage.message.documentMessage;
  }

  const quoted =
    direct?.extendedTextMessage?.contextInfo?.quotedMessage ||
    direct?.imageMessage?.contextInfo?.quotedMessage ||
    direct?.videoMessage?.contextInfo?.quotedMessage ||
    direct?.documentMessage?.contextInfo?.quotedMessage;

  if (quoted?.documentMessage) return quoted.documentMessage;
  if (quoted?.documentWithCaptionMessage?.message?.documentMessage) {
    return quoted.documentWithCaptionMessage.message.documentMessage;
  }

  return null;
}

function extractQuotedText(message) {
  const quoted = message?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!quoted) return "";
  return (
    quoted.conversation ||
    quoted.extendedTextMessage?.text ||
    quoted.documentWithCaptionMessage?.caption ||
    ""
  );
}

function looksLikeNetscapeCookies(content) {
  const text = String(content || "").trim();
  if (!text) return false;
  if (text.includes("# Netscape HTTP Cookie File") || text.includes("HTTP Cookie File")) {
    return true;
  }
  // Netscape lines usually have tab-separated domain, flag, path, secure, expiry, name, value
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
  return lines.some((line) => line.split("\t").length >= 6);
}

async function readDocumentBuffer(docMsg) {
  const stream = await downloadContentFromMessage(docMsg, "document");
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

module.exports = {
  name: "setyt",
  aliases: ["setcookies", "ytcookie"],
  description: "Save YouTube cookies.txt for yt-dlp",
  category: "Downloader",

  async execute({ sock, jid, message, text, args }) {
    try {
      const docMsg = extractCookiesDocumentMessage(message);
      let rawContent = "";

      if (docMsg) {
        const buffer = await readDocumentBuffer(docMsg);
        rawContent = buffer.toString("utf8");
      } else {
        const directText = String(text || args?.join(" ") || "").trim();
        const quotedText = extractQuotedText(message).trim();
        rawContent = directText || quotedText;
      }

      if (!rawContent || !rawContent.trim()) {
        return sock.sendMessage(
          jid,
          {
            text:
              "❌ *No cookies found!*\n\n" +
              "Send `cookies.txt` as a document with caption `.setyt` (or reply `.setyt` to a `cookies.txt` file)."
          },
          { quoted: message }
        );
      }

      const normalized = rawContent.replace(/\r\n/g, "\n").trim() + "\n";

      if (!looksLikeNetscapeCookies(normalized)) {
        return sock.sendMessage(
          jid,
          {
            text:
              "⚠️ *Invalid cookies format!*\n" +
              "Please send a valid Netscape format `cookies.txt` file (exported using a cookies extension)."
          },
          { quoted: message }
        );
      }

      const tempPath = COOKIES_FILE + ".tmp." + Date.now();
      fs.writeFileSync(tempPath, normalized, "utf8");
      fs.renameSync(tempPath, COOKIES_FILE);

      const cookieLineCount = normalized
        .split("\n")
        .filter((line) => line.trim() && !line.trim().startsWith("#")).length;

      return sock.sendMessage(
        jid,
        {
          text:
            "✅ *YouTube cookies saved!*\n" +
            "📄 File: `cookies.txt`\n" +
            "🍪 Cookie entries: *" +
            cookieLineCount +
            "*\n\n" +
            "Now `.ytv` will automatically use these cookies."
        },
        { quoted: message }
      );
    } catch (error) {
      console.error("[GALAXY-MD] .setyt error:", error);
      return sock.sendMessage(
        jid,
        { text: "❌ Failed to save cookies!\n" + (error?.message || "Unknown error") },
        { quoted: message }
      );
    }
  }
};
