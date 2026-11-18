"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

const TIMEOUT = 60000;
const DL_TIMEOUT = 300000;
const MAX_SIZE = 180 * 1024 * 1024;

const APIS = [
  {
    name: "ZellRayyV2",
    build: (q) => "https://zellrayy.com/download/ytplaymusic/v2?q=" + encodeURIComponent(q),
    parse: (j) => ({
      ok: j?.status === true,
      url: j?.result?.download || j?.result?.stream,
      title: j?.result?.title
    })
  },
  {
    name: "ZellRayy",
    build: (q) => "https://zellrayy.com/download/ytplaymusic?q=" + encodeURIComponent(q),
    parse: (j) => ({
      ok: j?.status === true,
      url: j?.result?.download || j?.result?.stream,
      title: j?.result?.title
    })
  },
  {
    name: "Nexray",
    build: (q) => "https://api.nexray.eu.cc/downloader/ytplay?q=" + encodeURIComponent(q),
    parse: (j) => ({
      ok: j?.status === true,
      url: j?.result?.download_url,
      title: j?.result?.title
    })
  },
  {
    name: "NexaDev",
    build: (q) => "https://api.nexadev.my.id/api/ytplay?q=" + encodeURIComponent(q),
    parse: (j) => ({
      ok: j?.status === true,
      url: j?.data?.url,
      title: j?.title
    })
  }
];

async function getJson(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(TIMEOUT)
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

async function downloadTo(url, file) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      Accept: "audio/mpeg,audio/*;q=0.9,*/*;q=0.8"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(DL_TIMEOUT)
  });
  if (!res.ok || !res.body) throw new Error("download HTTP " + res.status);

  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
  const size = fs.statSync(file).size;
  if (!size) throw new Error("empty file");
  if (size > MAX_SIZE) throw new Error("file too large");
}

async function fetchSong(query, file) {
  const errors = [];

  for (const api of APIS) {
    try {
      const json = await getJson(api.build(query));
      const { ok, url: dl, title } = api.parse(json);

      if (!ok || typeof dl !== "string" || !/^https?:\/\//i.test(dl)) {
        throw new Error("no valid link");
      }

      await downloadTo(dl, file);
      return { api: api.name, title: String(title || query).trim() };
    } catch (err) {
      errors.push(api.name + ": " + (err?.message || "failed"));
      console.warn("[GALAXY-MD] play API failed:", api.name, err?.message);
      try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
    }
  }

  throw new Error("All APIs failed\n" + errors.join("\n"));
}

module.exports = {
  name: "play",
  aliases: ["song"],
  description: "Search YouTube and send an MP3 audio file",
  category: "Downloader",

  async execute({ sock, jid, message, text, args }) {
    const query = String(text || args?.join(" ") || "").trim();

    if (!query) {
      return sock.sendMessage(
        jid,
        { text: "*Play / Song*\n\nEnter a song name.\nExample: .play Varnajaalam\nAlias: .song Varnajaalam" },
        { quoted: message }
      );
    }

    const tempFile = path.join(
      os.tmpdir(),
      "galaxy-play-" + Date.now() + "-" + Math.random().toString(16).slice(2) + ".mp3"
    );

    let statusMessage;
    const editStatus = async (status) => {
      try {
        if (statusMessage?.key) {
          await sock.sendMessage(jid, { text: status, edit: statusMessage.key });
        }
      } catch (error) {
        console.warn("[GALAXY-MD] Failed to edit play status:", error?.message);
      }
    };

    try {
      statusMessage = await sock.sendMessage(jid, { text: "Searching..." }, { quoted: message });

      const { title } = await fetchSong(query, tempFile);

      await editStatus("Sending MP3 file...");

      const safeTitle = title
        .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 100) || "song";

      // Audio file mathram. Thumbnail / caption / link preview illa.
      await sock.sendMessage(
        jid,
        {
          audio: { url: tempFile },
          mimetype: "audio/mpeg",
          fileName: safeTitle + ".mp3",
          ptt: false
        },
        { quoted: message }
      );

      await editStatus("Song sent successfully!");
    } catch (error) {
      console.error("[GALAXY-MD] play download failed:", error?.message || error);
      await editStatus("Song download failed!\n" + String(error?.message || error).slice(0, 300));
    } finally {
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      } catch (error) {
        console.warn("[GALAXY-MD] Could not delete song temp file:", error?.message);
      }
    }
  }
};
