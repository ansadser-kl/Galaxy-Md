"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

const TIMEOUT = 90000;
const DL_TIMEOUT = 300000;
const MAX_SIZE = 180 * 1024 * 1024;

// Fast & powerful first (ividathe order)
const APIS = [
  {
    name: "ZellRayy",
    build: (url) => "https://zellrayy.com/download/youtube?url=" + encodeURIComponent(url) + "&format=mp4",
    parse: (j) => ({
      ok: j?.status === true,
      url: j?.result?.download || j?.result?.stream,
      title: j?.result?.title,
      quality: j?.result?.quality || ""
    })
  },
  {
    name: "Kira",
    build: (url) => "https://kiraxmd-api.onrender.com/api/ytv?url=" + encodeURIComponent(url) + "&quality=720",
    parse: (j) => ({
      ok: j?.status === true,
      url: j?.result?.download,
      title: j?.result?.title,
      quality: j?.result?.quality || ""
    })
  },
  {
    name: "ZiaUl",
    build: (url) => "https://apiziaul.vercel.app/api/downloader/ytmp4?url=" + encodeURIComponent(url),
    parse: (j) => ({
      ok: j?.status === true,
      url: j?.result?.downloadUrl,
      title: j?.result?.title,
      quality: j?.result?.quality || ""
    })
  },
  {
    name: "XenoExe",
    build: (url) => "https://xenosirapis.zone.id/api/youtube?url=" + encodeURIComponent(url),
    parse: (j) => ({
      ok: j?.status === true,
      url: j?.downloadUrl,
      title: j?.title,
      quality: j?.quality || ""
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
      Accept: "video/mp4,application/octet-stream,*/*"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(DL_TIMEOUT)
  });
  if (!res.ok || !res.body) throw new Error("download HTTP " + res.status);

  const len = Number(res.headers.get("content-length") || 0);
  if (len > MAX_SIZE * 5) throw new Error("file too large");

  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
  const size = fs.statSync(file).size;
  if (!size) throw new Error("empty file");
}

async function fetchVideo(url, file) {
  const errors = [];

  for (const api of APIS) {
    try {
      const json = await getJson(api.build(url));
      const { ok, url: dl, title, quality } = api.parse(json);

      if (!ok || typeof dl !== "string" || !/^https?:\/\//i.test(dl)) {
        throw new Error("no valid link");
      }

      await downloadTo(dl, file);
      return { api: api.name, title: String(title || "YouTube Video"), quality: String(quality || "") };
    } catch (err) {
      errors.push(api.name + ": " + (err?.message || "failed"));
      console.warn("[GALAXY-MD] video API failed:", api.name, err?.message);
      try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
    }
  }

  throw new Error("All APIs failed\n" + errors.join("\n"));
}

module.exports = {
  name: "video",
  aliases: [],
  description: "Download YouTube videos as MP4",
  category: "Downloader",

  async execute({ sock, jid, message, text, args }) {
    const input = String(text || args?.join(" ") || "").trim();
    let url = input.match(/https?:\/\/\S+/i)?.[0]?.replace(/[)>]+$/, "");

    if (!url || !/(youtube\.com|youtu\.be)/i.test(url)) {
      return sock.sendMessage(
        jid,
        { text: "Please provide a valid YouTube link!\nExample: .video https://youtube.com/watch?v=xxxxx or https://youtube.com/shorts/xxxxx" },
        { quoted: message }
      );
    }

    if (url.includes("youtube.com/shorts/")) {
      const shortId = url.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]+)/)?.[1];
      if (shortId) url = "https://www.youtube.com/watch?v=" + shortId;
    }

    const tempFile = path.join(os.tmpdir(), "galaxy-video-" + Date.now() + "-" + Math.random().toString(16).slice(2) + ".mp4");
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
      statusMessage = await sock.sendMessage(jid, { text: "Downloading..." }, { quoted: message });

      const { title, quality } = await fetchVideo(url, tempFile);

      await editStatus("Sending...");

      const safeName = title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120) || "galaxy-video";
      const q = quality.replace(/p+$/i, "p");
      const caption = title.slice(0, 180) + "\nFormat: MP4" + (q ? "\nQuality: " + q : "");
      const size = fs.statSync(tempFile).size;

      if (size > 180 * 1024 * 1024) {
        await sock.sendMessage(jid, {
          document: { url: tempFile },
          mimetype: "video/mp4",
          fileName: safeName + ".mp4",
          caption: caption + "\nSent as document because file exceeds 180 MB."
        }, { quoted: message });
      } else {
        await sock.sendMessage(jid, {
          video: { url: tempFile },
          mimetype: "video/mp4",
          fileName: safeName + ".mp4",
          caption
        }, { quoted: message });
      }

      await editStatus("Download complete!");
    } catch (error) {
      console.error("[GALAXY-MD] Video download failed:", error);
      await editStatus("❌ Download failed!\n" + String(error?.message || error).slice(0, 300));
    } finally {
      try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch {}
    }
  }
};
