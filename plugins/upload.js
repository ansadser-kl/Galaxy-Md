"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

const MAX_BYTES = Number(process.env.UPLOAD_MAX_MB || 200) * 1024 * 1024; // പരമാവധി വലുപ്പം
const VIDEO_LIMIT = 180 * 1024 * 1024; // ഇതിൽ വലുതാണെങ്കിൽ document ആയി അയക്കും
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

const EXT_MIME = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  mp4: "video/mp4", mkv: "video/x-matroska", webm: "video/webm", mov: "video/quicktime", "3gp": "video/3gpp",
  mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", opus: "audio/ogg", wav: "audio/wav", aac: "audio/aac",
  pdf: "application/pdf", zip: "application/zip", txt: "text/plain", apk: "application/vnd.android.package-archive"
};

function safeFilename(value) {
  return String(value || "file")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 100) || "file";
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "Unknown";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return size.toFixed(unit === 0 ? 0 : 2) + " " + units[unit];
}

// ലോക്കൽ/പ്രൈവറ്റ് അഡ്രസുകൾ തടയുന്നു
function isBlockedHost(hostname) {
  const h = hostname.toLowerCase();
  return (
    h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h) ||
    /^0\./.test(h) || h === "::1" || h === "[::1]"
  );
}

function filenameFromHeaders(response, url) {
  const disposition = response.headers.get("content-disposition") || "";
  const star = disposition.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  const plain = disposition.match(/filename="?([^";]+)"?/i);
  let name = star?.[1] || plain?.[1] || "";
  try { name = decodeURIComponent(name); } catch {}
  if (!name) {
    try {
      const last = new URL(response.url || url).pathname.split("/").pop();
      name = decodeURIComponent(last || "");
    } catch {}
  }
  return safeFilename(name || "file");
}

// ഫയലിന്റെ ആദ്യ ബൈറ്റുകൾ നോക്കി തരം കണ്ടെത്തുന്നു
function sniffMime(file) {
  try {
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
    if (buf.slice(0, 4).toString("hex") === "89504e47") return "image/png";
    if (buf.slice(0, 3).toString() === "GIF") return "image/gif";
    if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return "image/webp";
    if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WAVE") return "audio/wav";
    if (buf.slice(4, 8).toString() === "ftyp") {
      return buf.slice(8, 12).toString().startsWith("M4A") ? "audio/mp4" : "video/mp4";
    }
    if (buf.slice(0, 4).toString("hex") === "1a45dfa3") return "video/webm";
    if (buf.slice(0, 3).toString() === "ID3" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return "audio/mpeg";
    if (buf.slice(0, 4).toString() === "OggS") return "audio/ogg";
    if (buf.slice(0, 4).toString() === "%PDF") return "application/pdf";
    if (buf.slice(0, 2).toString() === "PK") return "application/zip";
  } catch {}
  return "";
}

function detectMime(headerType, filename, file) {
  const type = String(headerType || "").split(";")[0].trim().toLowerCase();
  if (type && type !== "application/octet-stream" && type !== "binary/octet-stream") return type;
  const ext = path.extname(filename).slice(1).toLowerCase();
  if (EXT_MIME[ext]) return EXT_MIME[ext];
  return sniffMime(file) || "application/octet-stream";
}

module.exports = {
  name: "upload",
  aliases: [],
  description: "Download a file from a URL and send it to the chat",
  category: "Downloader",

  async execute({ sock, jid, message, text, args }) {
    const reply = (t) => sock.sendMessage(jid, { text: t }, { quoted: message });

    const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const quotedText = quoted?.conversation || quoted?.extendedTextMessage?.text || "";
    const input = String(text || args?.join(" ") || "").trim() || quotedText;

    const asDocument = /(^|\s)doc(\s|$)/i.test(input) && /https?:\/\//i.test(input.replace(/(^|\s)doc(\s|$)/i, " "));
    const url = input.match(/https?:\/\/[^\s<>"]+/i)?.[0]?.replace(/[)>.,]+$/, "");

    if (!url) {
      return reply(
        "🔗 ഒരു URL തരൂ.\n" +
        "ഉദാ: .upload https://files.catbox.moe/abc123.mp4\n" +
        "Document ആയി വേണമെങ്കിൽ: .upload doc <url>\n" +
        "(അല്ലെങ്കിൽ URL ഉള്ള മെസേജിന് റിപ്ലൈ ആയി .upload അടിക്കുക)"
      );
    }

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return reply("❌ URL ശരിയല്ല.");
    }
    if (isBlockedHost(parsed.hostname)) {
      return reply("❌ ഈ URL അനുവദനീയമല്ല.");
    }

    const tempFile = path.join(
      os.tmpdir(),
      "galaxy-upload-" + Date.now() + "-" + Math.random().toString(16).slice(2)
    );
    let statusMessage;

    const editStatus = async (status) => {
      try {
        if (statusMessage?.key) {
          await sock.sendMessage(jid, { text: status, edit: statusMessage.key });
        }
      } catch (err) {
        console.warn("[GALAXY-MD] Failed to edit .upload status:", err?.message);
      }
    };

    try {
      statusMessage = await sock.sendMessage(jid, { text: "⬇️ Downloading..." }, { quoted: message });

      const response = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "*/*" },
        redirect: "follow",
        signal: AbortSignal.timeout(300000)
      });

      if (!response.ok || !response.body) throw new Error("Download failed (" + response.status + ")");

      const declared = Number(response.headers.get("content-length") || 0);
      if (declared > MAX_BYTES) {
        throw new Error("ഫയൽ വളരെ വലുതാണ് (" + formatBytes(declared) + "). പരമാവധി " + formatBytes(MAX_BYTES));
      }

      // സ്ട്രീം ചെയ്ത് ഡിസ്കിലേക്ക് എഴുതുന്നു (RAM കുറച്ചേ എടുക്കൂ)
      let received = 0;
      const limiter = new TransformStream({
        transform(chunk, controller) {
          received += chunk.byteLength;
          if (received > MAX_BYTES) throw new Error("ഫയൽ വളരെ വലുതാണ്. പരമാവധി " + formatBytes(MAX_BYTES));
          controller.enqueue(chunk);
        }
      });
      await pipeline(Readable.fromWeb(response.body.pipeThrough(limiter)), fs.createWriteStream(tempFile));

      const stats = fs.statSync(tempFile);
      if (!stats.size) throw new Error("Empty file");

      const filename = filenameFromHeaders(response, url);
      const mimetype = detectMime(response.headers.get("content-type"), filename, tempFile);

      await editStatus("📤 Sending (" + formatBytes(stats.size) + ")...");

      const file = { url: tempFile };
      const quotedOpt = { quoted: message };

      if (!asDocument && mimetype.startsWith("image/")) {
        await sock.sendMessage(jid, { image: file, mimetype }, quotedOpt);
      } else if (!asDocument && mimetype === "video/mp4" && stats.size <= VIDEO_LIMIT) {
        await sock.sendMessage(jid, { video: file, mimetype, fileName: filename }, quotedOpt);
      } else if (!asDocument && mimetype.startsWith("audio/")) {
        await sock.sendMessage(jid, { audio: file, mimetype, fileName: filename }, quotedOpt);
      } else {
        await sock.sendMessage(jid, { document: file, mimetype, fileName: filename }, quotedOpt);
      }

      await editStatus("✅ Done!");
    } catch (error) {
      console.error("[GALAXY-MD] .upload error:", error);
      await editStatus("❌ Failed!\n" + String(error.message || "error").slice(0, 200));
    } finally {
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      } catch (err) {
        console.warn("[GALAXY-MD] Could not delete .upload temp file:", err?.message);
      }
    }
  }
};
