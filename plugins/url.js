"use strict";

const BASE = "https://ansadkl-file.onrender.com";
const CHUNK = 8 * 1024 * 1024;
const MAX_SIZE = 100 * 1024 * 1024; // bot memory kaaranam, venel koottaam

const EXT = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "video/3gpp": "3gp", "audio/mpeg": "mp3", "audio/mp4": "m4a",
  "audio/ogg": "ogg", "audio/ogg; codecs=opus": "ogg", "application/pdf": "pdf",
  "application/zip": "zip", "text/plain": "txt"
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(pathname, options = {}, timeout = 60000) {
  const res = await fetch(BASE + pathname, { ...options, signal: AbortSignal.timeout(timeout) });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data?.error || "API HTTP " + res.status);
  return data;
}

function getMedia(message) {
  const unwrap = (m) =>
    m?.ephemeralMessage?.message || m?.viewOnceMessage?.message ||
    m?.viewOnceMessageV2?.message || m?.documentWithCaptionMessage?.message || m;

  const own = unwrap(message?.message);
  const ctx = own?.extendedTextMessage?.contextInfo || own?.imageMessage?.contextInfo ||
    own?.videoMessage?.contextInfo || own?.documentMessage?.contextInfo;
  const quoted = unwrap(ctx?.quotedMessage);

  const types = ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"];
  const pick = (m) => types.find((t) => m?.[t]);

  if (quoted && pick(quoted)) {
    return {
      type: pick(quoted),
      node: quoted[pick(quoted)],
      msg: {
        key: { remoteJid: message.key.remoteJid, id: ctx.stanzaId, participant: ctx.participant },
        message: quoted
      }
    };
  }
  if (own && pick(own)) {
    return { type: pick(own), node: own[pick(own)], msg: message };
  }
  return null;
}

async function loadDownloader() {
  for (const name of ["@whiskeysockets/baileys", "baileys"]) {
    try {
      const mod = require(name);
      if (mod.downloadMediaMessage) return mod.downloadMediaMessage;
    } catch {}
  }
  throw new Error("Baileys downloadMediaMessage not found.");
}

async function uploadBuffer(buffer, name, mime) {
  const init = await api("/api/upload/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, size: buffer.length, mime })
  }, 90000);
  const id = init?.id;
  if (!id) throw new Error("Upload init failed.");

  for (let i = 0; i * CHUNK < buffer.length; i++) {
    const chunk = buffer.subarray(i * CHUNK, (i + 1) * CHUNK);
    await api("/api/upload/" + id + "/chunk?index=" + i, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: chunk
    }, 300000);
  }

  await api("/api/upload/" + id + "/complete", { method: "POST" }, 60000);

  let status;
  for (let i = 0; i < 120; i++) {
    await sleep(1500);
    status = await api("/api/upload/" + id, {}, 30000);
    if (status?.status === "done") break;
    if (status?.status === "error") throw new Error(status.error || "Upload processing failed.");
  }
  if (status?.status !== "done") throw new Error("Upload timed out.");

  let fileObj = status?.file;
  if (!fileObj) {
    const list = await api("/api/files?view=files", {}, 30000);
    const files = Array.isArray(list) ? list : list?.files || [];
    fileObj = files.find((f) => f.name === name) || files[0];
  }
  if (!fileObj) throw new Error("Upload done but file info not found.");
  return fileObj;
}

module.exports = {
  name: "url",
  aliases: ["tourl", "ansadkl", "upload"],
  description: "Upload replied media to Ansadkl Drive and get a DL link",
  category: "Tools",
  async execute({ sock, jid, message }) {
    const media = getMedia(message);
    if (!media) {
      return sock.sendMessage(
        jid,
        { text: "Oru file/image/video/audio-ilekku reply cheythu .url ayakkuka." },
        { quoted: message }
      );
    }

    let statusMessage;
    const editStatus = async (status) => {
      if (statusMessage?.key) {
        return sock.sendMessage(jid, { text: status, edit: statusMessage.key });
      }
    };

    try {
      const declared = Number(media.node.fileLength?.low ?? media.node.fileLength ?? 0);
      if (declared > MAX_SIZE) throw new Error("File too large (max " + MAX_SIZE / 1024 / 1024 + " MB).");

      statusMessage = await sock.sendMessage(jid, { text: "Uploading..." }, { quoted: message });

      const downloadMediaMessage = await loadDownloader();
      const buffer = await downloadMediaMessage(media.msg, "buffer", {});
      if (!buffer?.length) throw new Error("Could not download the media.");
      if (buffer.length > MAX_SIZE) throw new Error("File too large.");

      const mime = media.node.mimetype || "application/octet-stream";
      const ext = EXT[mime] || EXT[mime.split(";")[0]] || mime.split("/")[1]?.split(";")[0] || "bin";
      const name = String(media.node.fileName || "galaxy-" + Date.now() + "." + ext)
        .replace(/[\\/:*?"<>|]/g, "_").slice(0, 150);

      const fileObj = await uploadBuffer(buffer, name, mime);

      const shareCode = fileObj.code || fileObj.slug || fileObj.shortId || fileObj.shareId || fileObj.id;
      if (!shareCode) throw new Error("File share code not found.");

      const link = `${BASE}/dl/${shareCode}`;

      await editStatus(link);
    } catch (error) {
      console.error("[GALAXY-MD] Upload failed:", error);
      const msg = "Upload failed: " + (error?.message || "unknown error");
      try {
        await editStatus(msg);
      } catch {
        await sock.sendMessage(jid, { text: msg }, { quoted: message });
      }
    }
  }
};
