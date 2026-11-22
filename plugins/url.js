"use strict";

const BASE = "https://galaxy-md-w3vr.onrender.com";
const CHUNK = 8 * 1024 * 1024;
const MAX_SIZE = 100 * 1024 * 1024; // bot memory kaaranam, venel koottaam

const EXT = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "video/3gpp": "3gp", "audio/mpeg": "mp3", "audio/mp4": "m4a",
  "audio/ogg": "ogg", "application/pdf": "pdf", "application/zip": "zip", "text/plain": "txt"
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanName = (s) => String(s).replace(/[\\/:*?"<>|]/g, "_").slice(0, 150);

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
      node: quoted[pick(quoted)],
      msg: {
        key: { remoteJid: message.key.remoteJid, id: ctx.stanzaId, participant: ctx.participant },
        message: quoted
      }
    };
  }
  if (own && pick(own)) return { node: own[pick(own)], msg: message };
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

async function fetchUrl(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(300000)
  });
  if (!res.ok) throw new Error("URL download failed (HTTP " + res.status + ").");

  const len = Number(res.headers.get("content-length") || 0);
  if (len > MAX_SIZE) throw new Error("File too large (max " + MAX_SIZE / 1024 / 1024 + " MB).");

  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error("The URL returned an empty file.");
  if (buffer.length > MAX_SIZE) throw new Error("File too large.");

  const mime = (res.headers.get("content-type") || "application/octet-stream").split(";")[0].trim();
  const cd = res.headers.get("content-disposition") || "";
  let name =
    decodeURIComponent(cd.match(/filename\*=UTF-8''([^;]+)/i)?.[1] || "") ||
    cd.match(/filename="?([^";]+)"?/i)?.[1] || "";
  if (!name) {
    try { name = decodeURIComponent(new URL(url).pathname.split("/").pop() || ""); } catch {}
  }
  if (!name || !name.includes(".")) {
    name = (name || "galaxy-" + Date.now()) + "." + (EXT[mime] || mime.split("/")[1] || "bin");
  }
  return { buffer, mime, name: cleanName(name) };
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
    await api("/api/upload/" + id + "/chunk?index=" + i, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: buffer.subarray(i * CHUNK, (i + 1) * CHUNK)
    }, 300000);
  }

  await api("/api/upload/" + id + "/complete", { method: "POST" }, 60000);

  let status;
  for (let i = 0; i < 200; i++) {
    await sleep(1500);
    status = await api("/api/upload/" + id, {}, 30000);
    if (status?.status === "done") break;
    if (status?.status === "error") throw new Error(status.error || "Upload processing failed.");
  }
  if (status?.status !== "done" || !status.file?.hash) throw new Error("Upload timed out.");

  return status.file;
}

module.exports = {
  name: "url",
  aliases: [],
  description: "Upload replied media or a URL and get a download link",
  category: "Tools",
  async execute({ sock, jid, message, text, args }) {
    const input = String(text || args?.join(" ") || "").trim();
    const url = input.match(/https?:\/\/\S+/i)?.[0]?.replace(/[)>]+$/, "");
    const media = url ? null : getMedia(message);

    if (!url && !media) {
      return sock.sendMessage(
        jid,
        { text: "Oru file-ilekku reply cheythu .url ayakkuka, allenkil .url <link> ayakkuka." },
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
      statusMessage = await sock.sendMessage(jid, { text: "Uploading..." }, { quoted: message });

      let buffer, mime, name;
      if (url) {
        ({ buffer, mime, name } = await fetchUrl(url));
      } else {
        const declared = Number(media.node.fileLength?.low ?? media.node.fileLength ?? 0);
        if (declared > MAX_SIZE) throw new Error("File too large (max " + MAX_SIZE / 1024 / 1024 + " MB).");

        const downloadMediaMessage = await loadDownloader();
        buffer = await downloadMediaMessage(media.msg, "buffer", {});
        if (!buffer?.length) throw new Error("Could not download the media.");
        if (buffer.length > MAX_SIZE) throw new Error("File too large.");

        mime = media.node.mimetype || "application/octet-stream";
        const ext = EXT[mime] || EXT[mime.split(";")[0]] || mime.split("/")[1]?.split(";")[0] || "bin";
        name = cleanName(media.node.fileName || "galaxy-" + Date.now() + "." + ext);
      }

      const file = await uploadBuffer(buffer, name, mime);

      // link maathram
      await editStatus(BASE + "/dl/" + file.hash);
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
