"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const yts = require("yt-search");

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const API_URL = process.env.MUSIC_FINDER_URL || "https://music-finder-q8hd.onrender.com/api/recognize";
const MAX_INPUT = 50 * 1024 * 1024;
const MEDIA_TYPES = ["audioMessage", "videoMessage", "documentMessage"];

function unwrap(m) {
  let cur = m || {};
  for (let i = 0; i < 6; i++) {
    const next =
      cur.ephemeralMessage?.message ||
      cur.viewOnceMessage?.message ||
      cur.viewOnceMessageV2?.message ||
      cur.documentWithCaptionMessage?.message;
    if (!next) break;
    cur = next;
  }
  return cur;
}

// Reply cheytha message-il ninnu media edukkum
function getQuotedMedia(message) {
  const own = unwrap(message?.message);
  const ctx =
    own?.extendedTextMessage?.contextInfo ||
    own?.imageMessage?.contextInfo ||
    own?.videoMessage?.contextInfo ||
    own?.audioMessage?.contextInfo ||
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

// Audio-yude aadya 15 seconds mathram cut cheyyum
async function cutSample(inFile, outFile) {
  await run(
    FFMPEG,
    ["-y", "-i", inFile, "-vn", "-t", "15", "-ac", "1", "-ar", "44100", "-b:a", "128k", outFile],
    { timeout: 60000 }
  );
  const buf = fs.readFileSync(outFile);
  if (!buf.length) throw new Error("Sample cut failed.");
  return buf;
}

// Found aayaal title/artist/album edukkum, pala field names nokkum
function parseTrack(data) {
  const src = data?.result || data?.data || data;
  const title = src?.title || src?.track?.title || src?.music?.[0]?.title || "";
  const artist =
    src?.artist || src?.artists?.[0]?.name || src?.music?.[0]?.artists?.[0]?.name || "";
  const album = src?.album?.name || src?.album || src?.music?.[0]?.album?.name || "";
  return { title: String(title).trim(), artist: String(artist).trim(), album: String(album).trim() };
}

module.exports = {
  name: "find",
  aliases: ["shazam"],
  description: "Find a song from a replied audio or video",
  category: "Tools",

  async execute({ sock, jid, message }) {
    const send = (text) => sock.sendMessage(jid, { text }, { quoted: message });

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

      const form = new FormData();
      form.append("file", new Blob([sample], { type: "audio/mpeg" }), "sample.mp3");

      const res = await fetch(API_URL, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(90000),
      });
      if (!res.ok) throw new Error("Music API HTTP " + res.status);
      const data = await res.json();

      if (!data?.found) {
        return editStatus("❌ Song kandilla.");
      }

      const { title, artist, album } = parseTrack(data);
      if (!title) {
        // Field names manasilaayilla: raw response kaanikkum, athu paste cheythaal fix cheyyaam
        return editStatus("⚠️ Song kitti, pakshe title field kittiyilla.\n" + JSON.stringify(data).slice(0, 500));
      }

      const caption =
        `*Title :* ${title}\n` +
        `*Artist :* ${artist || "-"}\n` +
        `*Album :* ${album || "-"}`;

      let thumb = null;
      try {
        const search = await yts(`${title} ${artist}`.trim());
        thumb = search.videos?.[0]?.thumbnail || null;
      } catch {}

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
