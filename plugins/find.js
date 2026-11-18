"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");
const yts = require("yt-search");

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const MAX_INPUT = 50 * 1024 * 1024;
const MEDIA_TYPES = ["audioMessage", "videoMessage", "documentMessage"];

const ACR = {
  host: process.env.ACR_HOST || "identify-eu-west-1.acrcloud.com",
  endpoint: "/v1/identify",
  accessKey: process.env.ACR_ACCESS_KEY || "8c21a32a02bf79a4a26cb0fa5c941e95",
  accessSecret: process.env.ACR_ACCESS_SECRET || "NRSxpk6fKwEiVdNhyx5lR0DP8LzeflYpClNg1gze",
  signatureVersion: "1",
  dataType: "audio",
};

function unwrap(m) {
  let cur = m || {};
  for (let i = 0; i < 6; i++) {
    const next = cur.ephemeralMessage?.message || cur.viewOnceMessage?.message ||
      cur.viewOnceMessageV2?.message || cur.documentWithCaptionMessage?.message;
    if (!next) break;
    cur = next;
  }
  return cur;
}

// Reply cheytha message-il ninnu media edukkum
function getQuotedMedia(message) {
  const own = unwrap(message?.message);
  const ctx = own?.extendedTextMessage?.contextInfo || own?.imageMessage?.contextInfo ||
    own?.videoMessage?.contextInfo || own?.audioMessage?.contextInfo ||
    own?.documentMessage?.contextInfo;
  const quoted = unwrap(ctx?.quotedMessage);
  const type = MEDIA_TYPES.find((t) => quoted?.[t]);
  if (!quoted || !type) return null;
  return {
    node: quoted[type],
    msg: {
      key: { remoteJid: message.key.remoteJid, id: ctx.stanzaId, participant: ctx.participant },
      message: quoted,
    },
  };
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

// Audio-yude aadya 15 seconds mp3 aakkum (ACRCloud-inu sample)
async function cutSample(inFile, outFile) {
  await run(FFMPEG, ["-y", "-i", inFile, "-vn", "-t", "15", "-ac", "1", "-ar", "44100", "-b:a", "128k", outFile], {
    timeout: 60000,
  });
  const buf = fs.readFileSync(outFile);
  if (!buf.length) throw new Error("Sample cut failed.");
  return buf;
}

function signRequest(timestamp) {
  const stringToSign = ["POST", ACR.endpoint, ACR.accessKey, ACR.dataType, ACR.signatureVersion, timestamp].join("\n");
  return crypto.createHmac("sha1", ACR.accessSecret)
    .update(Buffer.from(stringToSign, "utf-8"))
    .digest("base64");
}

async function identify(sample) {
  const timestamp = (Date.now() / 1000).toString();
  const form = new FormData();
  form.append("sample", new Blob([sample]), "sample.mp3");
  form.append("sample_bytes", String(sample.length));
  form.append("access_key", ACR.accessKey);
  form.append("data_type", ACR.dataType);
  form.append("signature_version", ACR.signatureVersion);
  form.append("signature", signRequest(timestamp));
  form.append("timestamp", timestamp);

  const res = await fetch("https://" + ACR.host + ACR.endpoint, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error("ACRCloud HTTP " + res.status);
  return res.json();
}

module.exports = {
  name: "find",
  aliases: ["shazam"],
  description: "Find a song from a replied audio or video",
  category: "Tools",

  async execute({ sock, jid, message }) {
    const send = (text) => sock.sendMessage(jid, { text }, { quoted: message });

    if (!ACR.accessKey || !ACR.accessSecret) {
      return send("ACR_ACCESS_KEY / ACR_ACCESS_SECRET .env-il set cheyyuka.");
    }

    const media = getQuotedMedia(message);
    if (!media) return send("*Audio allenkil video-kku reply cheythu .find ayakkuka*");

    const id = Date.now() + "-" + Math.random().toString(16).slice(2);
    const inFile = path.join(os.tmpdir(), "galaxy-find-in-" + id);
    const sampleFile = path.join(os.tmpdir(), "galaxy-find-sample-" + id + ".mp3");
    let statusMessage;

    const editStatus = async (text) => {
      try {
        if (statusMessage?.key) await sock.sendMessage(jid, { text, edit: statusMessage.key });
      } catch {}
    };

    try {
      statusMessage = await sock.sendMessage(jid, { text: "🎧 Searching..." }, { quoted: message });

      const downloadMediaMessage = await loadDownloader();
      const buffer = await downloadMediaMessage(media.msg, "buffer", {});
      if (!buffer?.length) throw new Error("Could not download the media.");
      if (buffer.length > MAX_INPUT) throw new Error("File too large.");
      fs.writeFileSync(inFile, buffer);

      const sample = await cutSample(inFile, sampleFile);
      const json = await identify(sample);

      if (json?.status?.msg !== "Success") {
        return editStatus("❌ Song kandilla.\n" + (json?.status?.msg || ""));
      }

      const track = json?.metadata?.music?.[0];
      if (!track) return editStatus("❌ Song kandilla.");

      const title = track.title || "Unknown";
      const album = track.album?.name || "";
      const artists = Array.isArray(track.artists) ? track.artists.map((a) => a.name).join(", ") : "";
      const release = track.release_date || "";

      // YouTube-il thumbnail edukkum
      let thumb = null;
      try {
        const search = await yts(`${title} ${artists}`.trim());
        thumb = search.videos?.[0]?.thumbnail || null;
      } catch {}

      const caption =
        `*Title :* ${title}\n*Album :* ${album}\n*Artists :* ${artists}\n*Release Date :* ${release}`;

      if (thumb) {
        const imgRes = await fetch(thumb, { signal: AbortSignal.timeout(20000) });
        if (imgRes.ok) {
          const image = Buffer.from(await imgRes.arrayBuffer());
          await sock.sendMessage(jid, { image, caption }, { quoted: message });
        } else {
          await send(caption);
        }
      } else {
        await send(caption);
      }

      await editStatus("✅ Done!");
    } catch (error) {
      console.error("[GALAXY-MD] Find failed:", error?.message || error);
      await editStatus("❌ Find failed!\n" + String(error?.message || error).slice(0, 200));
    } finally {
      for (const f of [inFile, sampleFile]) {
        try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
      }
    }
  },
};
