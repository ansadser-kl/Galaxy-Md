"use strict";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const CHUNK_SIZE = 4000;               // ഓരോ മെസേജിലും പരമാവധി അക്ഷരങ്ങൾ
const MAX_CHUNKS = 40;                 // പരമാവധി മെസേജുകളുടെ എണ്ണം
const DELAY_MS = 700;                  // മെസേജുകൾക്കിടയിലെ ഇടവേള

const BAILEYS_PACKAGES = ["@whiskeysockets/baileys", "baileys", "@adiwajshing/baileys"];

async function loadDownloader() {
  for (const pkg of BAILEYS_PACKAGES) {
    try {
      const mod = require(pkg);
      if (mod?.downloadContentFromMessage) return mod.downloadContentFromMessage;
    } catch {}
  }
  for (const pkg of BAILEYS_PACKAGES) {
    try {
      const mod = await import(pkg);
      const fn = mod?.downloadContentFromMessage || mod?.default?.downloadContentFromMessage;
      if (fn) return fn;
    } catch {}
  }
  throw new Error("Baileys downloader not found");
}

function getQuotedDocument(message) {
  const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!quoted) return null;
  return (
    quoted.documentMessage ||
    quoted.documentWithCaptionMessage?.message?.documentMessage ||
    null
  );
}

function isTextFile(doc) {
  const name = String(doc.fileName || "").toLowerCase();
  const mime = String(doc.mimetype || "").toLowerCase();
  return name.endsWith(".txt") || mime === "text/plain";
}

function splitText(content, size) {
  const chunks = [];
  let current = "";

  const push = () => {
    if (current) {
      chunks.push(current);
      current = "";
    }
  };

  for (const line of content.split("\n")) {
    // ഒരു വരി തന്നെ വളരെ നീളമുള്ളതാണെങ്കിൽ മുറിക്കുന്നു
    if (line.length > size) {
      push();
      for (let i = 0; i < line.length; i += size) {
        chunks.push(line.slice(i, i + size));
      }
      continue;
    }
    if (current.length + line.length + 1 > size) push();
    current += (current ? "\n" : "") + line;
  }
  push();
  return chunks;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

module.exports = {
  name: "ttx",
  aliases: [],
  description: "Reply to a .txt file to send its full text in chat",
  category: "Tools",

  async execute({ sock, jid, message }) {
    const reply = (t) => sock.sendMessage(jid, { text: t }, { quoted: message });

    const doc = getQuotedDocument(message);
    if (!doc) {
      return reply("📄 ഒരു .txt ഫയലിന് റിപ്ലൈ ആയി .ttx അടിക്കുക.");
    }

    if (!isTextFile(doc)) {
      return reply("❌ ഇത് .txt ഫയൽ അല്ല. ടെക്സ്റ്റ് ഫയലിന് മാത്രമേ പറ്റൂ.");
    }

    const declaredSize = Number(doc.fileLength || 0);
    if (declaredSize > MAX_FILE_SIZE) {
      return reply("❌ ഫയൽ വളരെ വലുതാണ് (പരമാവധി 5 MB).");
    }

    try {
      const downloadContentFromMessage = await loadDownloader();
      const stream = await downloadContentFromMessage(doc, "document");

      const buffers = [];
      let total = 0;
      for await (const chunk of stream) {
        total += chunk.length;
        if (total > MAX_FILE_SIZE) throw new Error("ഫയൽ വളരെ വലുതാണ് (പരമാവധി 5 MB).");
        buffers.push(chunk);
      }

      const content = Buffer.concat(buffers)
        .toString("utf8")
        .replace(/^\uFEFF/, "")
        .replace(/\r\n?/g, "\n")
        .trim();

      if (!content) {
        return reply("⚠️ ഫയൽ ശൂന്യമാണ്.");
      }

      const chunks = splitText(content, CHUNK_SIZE);
      const toSend = chunks.slice(0, MAX_CHUNKS);

      for (let i = 0; i < toSend.length; i++) {
        await sock.sendMessage(
          jid,
          { text: toSend[i] },
          i === 0 ? { quoted: message } : undefined
        );
        if (i < toSend.length - 1) await sleep(DELAY_MS);
      }

      if (chunks.length > MAX_CHUNKS) {
        await reply("⚠️ ഫയൽ വളരെ നീളമുള്ളതിനാൽ ആദ്യത്തെ " + MAX_CHUNKS + " ഭാഗങ്ങൾ മാത്രം അയച്ചു.");
      }
    } catch (error) {
      console.error("[GALAXY-MD] .ttx error:", error);
      await reply("❌ ഫയൽ വായിക്കാൻ പറ്റിയില്ല: " + String(error.message || "error").slice(0, 150));
    }
  }
};
