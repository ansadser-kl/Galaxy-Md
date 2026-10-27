"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

function safeFilename(value) {
  return String(value || "twitter-media")
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100) || "twitter-media";
}

function isTwitterUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return ["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"].includes(host);
  } catch {
    return false;
  }
}

function chooseMedia(media) {
  if (media?.type === "video" || media?.video) {
    const mp4s = (Array.isArray(media.formats) ? media.formats : [])
      .filter(item => item?.container === "mp4" && typeof item.url === "string")
      .sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0));
    const url = mp4s[0]?.url || media.url;
    return url ? { url, type: "video", extension: ".mp4" } : null;
  }

  const url = media?.url || media?.image;
  if (!url) return null;
  const extension = String(media.extension || "").toLowerCase();
  return {
    url,
    type: "image",
    extension: extension === "png" ? ".png" : extension === "webp" ? ".webp" : ".jpg"
  };
}

module.exports = {
  name: "twitter",
  aliases: ["x", "tweet", "twitdl"],
  description: "Download videos and images from X/Twitter",
  category: "Downloader",

  async execute({ sock, jid, message, text, args }) {
    const input = String(text || args?.join(" ") || "").trim();
    const url = input.match(/https?:\/\/\S+/i)?.[0]?.replace(/[)>.,]+$/, "");

    if (!url || !isTwitterUrl(url)) {
      return sock.sendMessage(
        jid,
        {
          text: "*X / Twitter Downloader*\n\nSend an X/Twitter post link.\nExample: .twitter https://x.com/username/status/123456789"
        },
        { quoted: message }
      );
    }

    const tempFiles = [];
    let statusMessage;
    const editStatus = async status => {
      if (statusMessage?.key) {
        await sock.sendMessage(jid, { text: status, edit: statusMessage.key });
      }
    };

    try {
      statusMessage = await sock.sendMessage(
        jid,
        { text: "🐦 Fetching X/Twitter post..." },
        { quoted: message }
      );

      const apiUrl = new URL("https://api.nexray.eu.cc/downloader/aio");
      apiUrl.searchParams.set("url", url);

      const apiResponse = await fetch(apiUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(60000)
      });
      if (!apiResponse.ok) throw new Error("Downloader API returned HTTP " + apiResponse.status);

      const payload = await apiResponse.json();
      const result = payload?.result;
      if (payload?.status !== true || !result || result.error) {
        throw new Error("No downloadable media was returned.");
      }

      const mediaList = (Array.isArray(result.medias) ? result.medias : [])
        .map(chooseMedia)
        .filter(item => item && /^https?:\/\//i.test(item.url));

      if (!mediaList.length) throw new Error("No supported media was found in the post.");

      const author = result.author ? "@" + String(result.author).replace(/^@+/, "") : "";
      const title = String(result.title || "X / Twitter media").trim().slice(0, 500);
      const caption = [title, author, result.url || url].filter(Boolean).join("\n\n");

      // Send each distinct media URL once, preferring the best available MP4 quality.
      const uniqueMedia = [...new Map(mediaList.map(item => [item.url, item])).values()].slice(0, 6);
      for (let index = 0; index < uniqueMedia.length; index++) {
        const media = uniqueMedia[index];
        const filePath = path.join(
          os.tmpdir(),
          "galaxy-twitter-" + Date.now() + "-" + index + "-" +
          Math.random().toString(16).slice(2) + media.extension
        );
        tempFiles.push(filePath);

        await editStatus("⬇️ Downloading X/Twitter media (" + (index + 1) + "/" + uniqueMedia.length + ")...");

        const mediaResponse = await fetch(media.url, {
          headers: { "User-Agent": "Mozilla/5.0", "Accept": "*/*" },
          redirect: "follow",
          signal: AbortSignal.timeout(300000)
        });
        if (!mediaResponse.ok || !mediaResponse.body) {
          throw new Error("Media download failed (HTTP " + mediaResponse.status + ").");
        }

        await pipeline(Readable.fromWeb(mediaResponse.body), fs.createWriteStream(filePath));
        if (!fs.statSync(filePath).size) throw new Error("Downloaded media was empty.");

        await editStatus("📤 Sending X/Twitter media (" + (index + 1) + "/" + uniqueMedia.length + ")...");
        const fileName = safeFilename("twitter-" + (result.author || "media") + (uniqueMedia.length > 1 ? "-" + (index + 1) : "")) + media.extension;
        if (media.type === "video") {
          await sock.sendMessage(
            jid,
            {
              video: { url: filePath },
              mimetype: "video/mp4",
              fileName,
              caption: index === 0 ? caption : "🐦 X/Twitter video (" + (index + 1) + ")"
            },
            { quoted: message }
          );
        } else {
          await sock.sendMessage(
            jid,
            {
              image: { url: filePath },
              mimetype: media.extension === ".png" ? "image/png" : media.extension === ".webp" ? "image/webp" : "image/jpeg",
              caption: index === 0 ? caption : "🐦 X/Twitter image (" + (index + 1) + ")"
            },
            { quoted: message }
          );
        }
      }

      await editStatus("✅ X/Twitter download complete.");
    } catch (error) {
      console.error("[GALAXY-MD] X/Twitter download failed:", error?.message || error);
      try {
        await editStatus("❌ X/Twitter download failed. The post may be private, unavailable, or the API may be busy.");
      } catch {
        await sock.sendMessage(
          jid,
          { text: "❌ X/Twitter download failed. Please try again later." },
          { quoted: message }
        );
      }
    } finally {
      for (const filePath of tempFiles) {
        try { fs.unlinkSync(filePath); } catch {}
      }
    }
  }
};
