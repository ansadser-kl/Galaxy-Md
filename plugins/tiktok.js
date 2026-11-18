"use strict";

const TIMEOUT = 60000;
const DL_TIMEOUT = 300000;
const MAX_SIZE = 180 * 1024 * 1024;

const clean = (u) => String(u || "").replace(/\\\//g, "/").replace(/&amp;/g, "&");
const isUrl = (u) => typeof u === "string" && /^https?:\/\//i.test(clean(u));

// Watermark illaatha video first. Fast & powerful APIs first.
const APIS = [
  {
    name: "Nexray",
    build: (url) => "https://api.nexray.eu.cc/downloader/tiktok?url=" + encodeURIComponent(url),
    parse: (j) => ({
      ok: j?.status === true,
      url: clean(j?.result?.data || j?.result?.alternatives?.selected || j?.result?.alternatives?.hd),
      title: j?.result?.title,
    }),
  },
  {
    name: "ZellRayy",
    build: (url) => "https://zellrayy.com/download/tiktok?url=" + encodeURIComponent(url),
    parse: (j) => ({
      ok: j?.status === true,
      url: clean(j?.result?.hdplay || j?.result?.play),
      title: j?.result?.title,
    }),
  },
];

async function getJson(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

async function downloadBuffer(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      Accept: "video/mp4,*/*",
      Referer: "https://www.tiktok.com/",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(DL_TIMEOUT),
  });
  if (!res.ok) throw new Error("download HTTP " + res.status);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error("empty file");
  if (buffer.length > MAX_SIZE) throw new Error("file too large");
  return buffer;
}

async function fetchVideo(url) {
  const errors = [];
  for (const api of APIS) {
    try {
      const json = await getJson(api.build(url));
      const { ok, url: dl, title } = api.parse(json);
      if (!ok || !isUrl(dl)) throw new Error("no valid link");
      const buffer = await downloadBuffer(dl);
      return { api: api.name, buffer, title: String(title || "").trim() };
    } catch (err) {
      errors.push(api.name + ": " + (err?.message || "failed"));
      console.warn("[GALAXY-MD] tiktok API failed:", api.name, err?.message);
    }
  }
  throw new Error("All APIs failed\n" + errors.join("\n"));
}

module.exports = {
  name: "tiktok",
  aliases: ["tt"],
  description: "Download TikTok videos without watermark",
  category: "Downloader",

  async execute({ sock, jid, message, text, args }) {
    const input = String(text || args?.join(" ") || "").trim();
    const url = input.match(/https?:\/\/\S+/i)?.[0]?.replace(/[)>]+$/, "");

    if (!url || !/(tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com)/i.test(url)) {
      return sock.sendMessage(
        jid,
        { text: "Please provide a valid TikTok link!\nExample: .tiktok https://vm.tiktok.com/xxxxx/\nAlias: .tt <link>" },
        { quoted: message }
      );
    }

    let statusMessage;
    const editStatus = async (status) => {
      try {
        if (statusMessage?.key) await sock.sendMessage(jid, { text: status, edit: statusMessage.key });
      } catch {}
    };

    try {
      statusMessage = await sock.sendMessage(jid, { text: "Downloading..." }, { quoted: message });
      const { buffer, title } = await fetchVideo(url);

      await sock.sendMessage(
        jid,
        {
          video: buffer,
          mimetype: "video/mp4",
          caption: title ? title.slice(0, 500) : "",
        },
        { quoted: message }
      );
      await editStatus("Download complete!");
    } catch (error) {
      console.error("[GALAXY-MD] TikTok download failed:", error?.message || error);
      await editStatus("❌ Download failed!\n" + String(error?.message || error).slice(0, 300));
    }
  },
};
