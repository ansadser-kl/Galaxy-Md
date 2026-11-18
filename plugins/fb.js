"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

const TIMEOUT = 90000;
const DL_TIMEOUT = 300000;
const MAX_SIZE = 180 * 1024 * 1024;

const clean = (u) => String(u || "").replace(/\\\//g, "/").replace(/&amp;/g, "&");
const isUrl = (u) => typeof u === "string" && /^https?:\/\//i.test(clean(u));

// Last-il ulla APIs first
const APIS = [
  {
    name: "ZellRayy",
    build: (url) => "https://zellrayy.com/download/facebook?url=" + encodeURIComponent(url),
    parse: (j) => {
      const r = j?.result;
      const url = r?.hd || r?.sd || r?.media?.[0]?.url;
      return { ok: j?.status === true, url: clean(url) };
    }
  },
  {
    name: "Nexray",
    build: (url) => "https://api.nexray.eu.cc/downloader/facebook?url=" + encodeURIComponent(url),
    parse: (j) => {
      const list = Array.isArray(j?.result?.data) ? j.result.data : [];
      const item = list.find((x) => x?.type === "video") || list[0];
      return { ok: j?.status === true, url: clean(item?.url) };
    }
  },
  {
    name: "JerryCoder",
    build: (url) => "https://jerrycoder.oggyapi.workers.dev/down/fb?url=" + encodeURIComponent(url),
    parse: (j) => {
      const list = Array.isArray(j?.results) ? j.results : [];
      // "320kbps" audio entry skip, video quality pick (HD first)
      const item = list.find((x) => /720|hd/i.test(x?.quality || "")) ||
                   list.find((x) => /p/i.test(x?.quality || "") && isUrl(clean(x?.url))) ||
                   list[0];
      return { ok: j?.status === "success", url: clean(item?.url) };
    }
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

  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
  const size = fs.statSync(file).size;
  if (!size) throw new Error("empty file");
  if (size > MAX_SIZE * 5) throw new Error("file too large");
}

async function fetchFacebook(url, file) {
  const errors = [];

  for (const api of APIS) {
    try {
      const json = await getJson(api.build(url));
      const { ok, url: dl } = api.parse(json);
      if (!ok || !isUrl(dl)) throw new Error("no valid video link");

      await downloadTo(dl, file);
      return { api: api.name };
    } catch (err) {
      errors.push(api.name + ": " + (err?.message || "failed"));
      console.warn("[GALAXY-MD] facebook API failed:", api.name, err?.message);
      try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
    }
  }

  throw new Error("All APIs failed\n" + errors.join("\n"));
}

module.exports = {
  name: "fb",
  aliases: ["facebook"],
  description: "Download Facebook videos",
  category: "Downloader",

  async execute({ sock, jid, message, text, args }) {
    const input = String(text || args?.join(" ") || "").trim();
    const url = input.match(/https?:\/\/\S+/i)?.[0]?.replace(/[)>]+$/, "");

    if (!url || !/(facebook\.com|fb\.watch|fb\.com)/i.test(url)) {
      return sock.sendMessage(
        jid,
        { text: "Please provide a valid Facebook video link!\nExample: .fb https://www.facebook.com/share/v/xxxxx/\nAlias: .facebook <link>" },
        { quoted: message }
      );
    }

    const tempFile = path.join(
      os.tmpdir(),
      "galaxy-fb-" + Date.now() + "-" + Math.random().toString(16).slice(2) + ".mp4"
    );
    let statusMessage;

    const editStatus = async (status) => {
      try {
        if (statusMessage?.key) {
          await sock.sendMessage(jid, { text: status, edit: statusMessage.key });
        }
      } catch (err) {
        console.warn("[GALAXY-MD] Failed to edit fb status:", err?.message);
      }
    };

    try {
      statusMessage = await sock.sendMessage(jid, { text: "Downloading..." }, { quoted: message });

      await fetchFacebook(url, tempFile);

      await editStatus("Sending...");

      await sock.sendMessage(jid, {
        video: { url: tempFile },
        mimetype: "video/mp4",
        fileName: "facebook-video.mp4",
        caption: ""
      }, { quoted: message });

      await editStatus("Download complete!");
    } catch (error) {
      console.error("[GALAXY-MD] Facebook download failed:", error);
      await editStatus("❌ Download failed!\n" + String(error?.message || error).slice(0, 300));
    } finally {
      try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch {}
    }
  }
};
