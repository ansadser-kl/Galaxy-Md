"use strict";

const TIMEOUT = 60000;
const DL_TIMEOUT = 300000;
const MAX_IMAGE = 20 * 1024 * 1024;
const MAX_VIDEO = 180 * 1024 * 1024;

const clean = (u) => String(u || "").replace(/\\\//g, "/").replace(/&amp;/g, "&");
const isUrl = (u) => typeof u === "string" && /^https?:\/\//i.test(clean(u));

// Video-kku munpu: direct video field, pinne media/videos list-il type video
function findVideo(j) {
  const candidates = [
    j?.videoUrl, j?.video, j?.result?.video, j?.result?.videoUrl,
    j?.result?.hd, j?.result?.sd, j?.result?.download,
    j?.result?.videos?.[0]?.url, j?.videos?.[0]?.url,
    j?.result?.media?.find?.((m) => m?.type === "video")?.url,
    j?.result?.data?.find?.((m) => m?.type === "video")?.url,
    j?.media?.find?.((m) => m?.type === "video")?.url
  ];
  if (j?.type === "video" && j?.downloadUrl) candidates.unshift(j.downloadUrl);
  if (j?.result?.type === "video" && j?.result?.url) candidates.unshift(j.result.url);
  return candidates.map(clean).find(isUrl) || "";
}

// Image-kku: image field
function findImage(j) {
  const candidates = [
    j?.downloadUrl, j?.url, j?.result?.image, j?.result?.thumbnail, j?.thumbnail
  ];
  return candidates.map(clean).find(isUrl) || "";
}

const APIS = [
  {
    name: "XenoExe",
    build: (url) => "https://xenosirapis.zone.id/api/klickpin?url=" + encodeURIComponent(url),
    ok: (j) => j?.status === true
  },
  {
    name: "Nexray",
    build: (url) => "https://api.nexray.eu.cc/downloader/pinterest?url=" + encodeURIComponent(url),
    ok: (j) => j?.status === true
  },
  {
    name: "JerryCoder",
    build: (url) => "https://jerrycoder.oggyapi.workers.dev/down/pinterest?url=" + encodeURIComponent(url),
    ok: (j) => j?.status === "success"
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

async function downloadBuffer(url, max) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      Accept: "video/mp4,image/*,*/*"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(DL_TIMEOUT)
  });
  if (!res.ok) throw new Error("download HTTP " + res.status);

  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error("empty file");
  if (buffer.length > max) throw new Error("file too large");
  return buffer;
}

async function fetchPin(url) {
  const errors = [];

  for (const api of APIS) {
    try {
      const json = await getJson(api.build(url));
      if (!api.ok(json)) throw new Error("API status false");

      const title = String(json?.title || json?.result?.title || "").trim();

      // 1. Video first
      const video = findVideo(json);
      if (video) {
        const buffer = await downloadBuffer(video, MAX_VIDEO);
        return { kind: "video", api: api.name, buffer, title };
      }

      // 2. Illenkil image
      const image = findImage(json);
      if (image) {
        const buffer = await downloadBuffer(image, MAX_IMAGE);
        return { kind: "image", api: api.name, buffer, title };
      }

      throw new Error("no media link");
    } catch (err) {
      errors.push(api.name + ": " + (err?.message || "failed"));
      console.warn("[GALAXY-MD] pinterest API failed:", api.name, err?.message);
    }
  }

  throw new Error("All APIs failed\n" + errors.join("\n"));
}

module.exports = {
  name: "pinterest",
  aliases: ["pin"],
  description: "Download Pinterest images and videos",
  category: "Downloader",

  async execute({ sock, jid, message, text, args }) {
    const input = String(text || args?.join(" ") || "").trim();
    const url = input.match(/https?:\/\/\S+/i)?.[0]?.replace(/[)>]+$/, "");

    if (!url || !/(pinterest\.[a-z.]+|pin\.it)/i.test(url)) {
      return sock.sendMessage(
        jid,
        { text: "Please provide a valid Pinterest link!\nExample: .pinterest https://www.pinterest.com/pin/xxxxx/\nAlias: .pin <link>" },
        { quoted: message }
      );
    }

    let statusMessage;
    const editStatus = async (status) => {
      try {
        if (statusMessage?.key) {
          await sock.sendMessage(jid, { text: status, edit: statusMessage.key });
        }
      } catch (err) {
        console.warn("[GALAXY-MD] Failed to edit pinterest status:", err?.message);
      }
    };

    try {
      statusMessage = await sock.sendMessage(jid, { text: "Downloading..." }, { quoted: message });

      const { kind, buffer, title } = await fetchPin(url);
      const caption = title ? title.slice(0, 500) : "";

      if (kind === "video") {
        await sock.sendMessage(jid, {
          video: buffer,
          mimetype: "video/mp4",
          caption
        }, { quoted: message });
      } else {
        await sock.sendMessage(jid, {
          image: buffer,
          caption
        }, { quoted: message });
      }

      await editStatus("Download complete!");
    } catch (error) {
      console.error("[GALAXY-MD] Pinterest download failed:", error);
      await editStatus("❌ Download failed!\n" + String(error?.message || error).slice(0, 300));
    }
  }
};
