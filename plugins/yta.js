"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

const TIMEOUT = 60000;
const DL_TIMEOUT = 300000;
const MAX_SIZE = 180 * 1024 * 1024;

// Fast & powerful first (ividathe order)
const APIS = [
  {
    name: "JerryCoder",
    build: (url) => "https://jerrycoder.oggyapi.workers.dev/down/ytmp3?url=" + encodeURIComponent(url),
    parse: (j) => ({
      ok: j?.status === "success" || j?.status === true,
      url: j?.url,
      title: j?.title
    })
  },
  {
    name: "ZellRayy",
    build: (url) => "https://zellrayy.com/download/ytmp3?url=" + encodeURIComponent(url),
    parse: (j) => ({
      ok: j?.status === true,
      url: j?.result?.download,
      title: j?.result?.title
    })
  },
  {
    name: "Nexray",
    build: (url) => "https://api.nexray.eu.cc/downloader/ytmp3?url=" + encodeURIComponent(url),
    parse: (j) => ({
      ok: j?.status === true,
      url: j?.result?.url,
      title: j?.result?.title
    })
  },
  {
    name: "ZiaUl",
    build: (url) => "https://apiziaul.vercel.app/api/downloader/ytmp3?url=" + encodeURIComponent(url),
    parse: (j) => ({
      ok: j?.status === true,
      url: j?.result?.downloadUrl,
      title: j?.result?.title
    })
  },
  {
    name: "XenoExe",
    build: (url) => "https://xenosirapis.zone.id/api/ytmp3dl?url=" + encodeURIComponent(url),
    parse: (j) => ({
      ok: j?.status === true,
      url: j?.downloadUrl,
      title: j?.title
    })
  }
];

async function getJson(url) {
  const res = await fetch(url, {
    method: "GET",
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

  const len = Number(res.headers.get("content-length") || 0);
  if (len > MAX_SIZE) throw new Error("file too large");

  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
  const size = fs.statSync(file).size;
  if (!size) throw new Error("empty file");
  if (size > MAX_SIZE) throw new Error("file too large");
}

// API-kal try cheyyunnu, aadyam work aavunnath return cheyyum
async function fetchAudio(url, file) {
  const errors = [];

  for (const api of APIS) {
    try {
      const json = await getJson(api.build(url));
      const { ok, url: dl, title } = api.parse(json);

      if (!ok || typeof dl !== "string" || !/^https?:\/\//i.test(dl)) {
        throw new Error("no valid link");
      }

      await downloadTo(dl, file);
      return { api: api.name, title: String(title || "youtube-audio") };
    } catch (err) {
      errors.push(api.name + ": " + (err?.message || "failed"));
      console.warn("[GALAXY-MD] yta API failed:", api.name, err?.message);
      try { fs.existsSync(file) && fs.unlinkSync(file); } catch {}
    }
  }

  throw new Error("All APIs failed\n" + errors.join("\n"));
}

module.exports = {
  name: "yta",
  aliases: ["audio"],
  description: "Download YouTube audio as MP3",
  category: "Downloader",

  async execute({ sock, jid, message, text, args }) {
    const input = String(text || args?.join(" ") || "").trim();
    const url = input.match(/https?:\/\/\S+/i)?.[0]?.replace(/[)>]+$/, "");

    if (!url || !/(youtube\.com|youtu\.be)/i.test(url)) {
      return sock.sendMessage(
        jid,
        {
          text: "Please provide a valid YouTube link!\nExample: .yta https://youtu.be/VIDEO_ID\nAlias: .audio <YouTube URL>"
        },
        { quoted: message }
      );
    }

    const tempFile = path.join(
      os.tmpdir(),
      "galaxy-yta-" + Date.now() + "-" + Math.random().toString(16).slice(2) + ".mp3"
    );

    let statusMessage;
    const editStatus = async (status) => {
      try {
        if (statusMessage?.key) {
          await sock.sendMessage(jid, { text: status, edit: statusMessage.key });
        }
      } catch (err) {
        console.warn("[GALAXY-MD] Failed to edit status message:", err?.message);
      }
    };

    try {
      statusMessage = await sock.sendMessage(
        jid,
        { text: "🎵 Downloading audio..." },
        { quoted: message }
      );

      const { title } = await fetchAudio(url, tempFile);

      await editStatus("📤 Sending MP3...");

      const safeTitle = title
        .replace(/[\\/:*?"<>|]/g, "_")
        .trim()
        .slice(0, 100) || "audio";

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

      await editStatus("✅ Download complete!");
    } catch (error) {
      console.error("[GALAXY-MD] YouTube audio download error:", error);
      await editStatus("❌ Download failed!\n" + String(error?.message || error).slice(0, 300));
    } finally {
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      } catch (err) {
        console.warn("[GALAXY-MD] Could not delete temp file:", err?.message);
      }
    }
  }
};
