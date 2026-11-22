"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const API_URL = process.env.MUSIC_FINDER_URL || "https://music-finder-cp4u.onrender.com/api/recognize";
const MAX_INPUT = 50 * 1024 * 1024;
const SAMPLE_SECONDS = 15;
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

// Reply cheytha message-il ninnu audio/video/document edukkum
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

function loadDownloader() {
  for (const name of ["baileys", "@whiskeysockets/baileys"]) {
    try {
      const mod = require(name);
      if (typeof mod.downloadMediaMessage === "function") return mod.downloadMediaMessage;
    } catch {}
  }
  throw new Error("Baileys downloadMediaMessage not found.");
}

// Audio-yude aadya 15 seconds mathram, mono mp3 aakkum
async function cutSample(inFile, outFile) {
  await run(
    FFMPEG,
    ["-y", "-i", inFile, "-vn", "-t", String(SAMPLE_SECONDS), "-ac", "1", "-ar", "44100", "-b:a", "128k", outFile],
    { timeout: 60000 }
  );
  const buf = fs.readFileSync(outFile);
  if (!buf.length) throw new Error("Sample cut failed.");
  return buf;
}

// Found aayaal track info edukkum. Field names pala reethiyil nokkum.
function parseTrack(data) {
  const src = data?.result || data?.data || data;
  const track = src?.music?.[0] || src?.track || src;
  const title = track?.title || src?.title || "";
  const artist =
    (Array.isArray(track?.artists) ? track.artists.map((a) => a?.name).filter(Boolean).join(", ") : "") ||
    track?.artist ||
    src?.artist ||
    "";
  const album = track?.album?.name || track?.album || src?.album || "";
  const release = track?.release_date || src?.release_date || "";
  return {
    title: String(title).trim(),
    artist: String(artist).trim(),
    album: String(album).trim(),
    release: String(release).trim(),
  };
}

// API response-il thumbnail/cover url undengil edukkum (field name vyathyaasam nokkum)
function apiThumbnail(data) {
  const src = data?.result || data?.data || data;
  const track = src?.music?.[0] || src?.track || src;
  const candidates = [
    track?.coverart, src?.coverart, track?.background, src?.background,
    track?.thumbnail, track?.thumb, track?.image, track?.cover, track?.artwork,
    track?.album?.cover, track?.album?.thumbnail, track?.album?.image,
    src?.thumbnail, src?.thumb, src?.image, src?.cover, src?.artwork,
  ];
  return candidates.find((u) => typeof u === "string" && /^https?:\/\//i.test(u)) || null;
}

// yt-search optional: illenkil thumbnail illaathe thaan work aakum
async function findThumbnail(query) {
  let yts;
  try {
    yts = require("yt-search");
  } catch {
    return null;
  }
  try {
    const search = await yts(query);
    return search.videos?.[0]?.thumbnail || null;
  } catch {
    return null;
  }
}

async function fetchImage(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

module.exports = {
  name: "find",
  aliases: ["shazam"],
  description: "Find a song from a replied audio or video",
  category: "Tools",

  async execute({ sock, jid, message }) {
    const send = (text) => sock.sendMessage(jid, { text }, { quoted: message });

    const media = getQuotedMedia(message);
    if (!media) {
      return send("*Audio allenkil video-kku reply cheythu .find ayakkuka*");
    }

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

      const downloadMediaMessage = loadDownloader();
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

      // API: {"found":false} aanenkil song illa
      if (!data?.found) {
        return editStatus("❌ Song kandilla.");
      }

      const { title, artist, album, release } = parseTrack(data);
      if (!title) {
        return editStatus("⚠️ Song kitti, pakshe title field kittiyilla.\n" + JSON.stringify(data).slice(0, 400));
      }

      const caption =
        `*Title :* ${title}\n` +
        `*Artist :* ${artist || "-"}\n` +
        `*Album :* ${album || "-"}` +
        (release ? `\n*Release :* ${release}` : "");

      const thumbUrl = apiThumbnail(data) || (await findThumbnail(`${title} ${artist}`.trim()));
      const image = thumbUrl ? await fetchImage(thumbUrl) : null;

      if (image) {
        await sock.sendMessage(jid, { image, caption }, { quoted: message });
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
