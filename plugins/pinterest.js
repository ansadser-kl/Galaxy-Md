"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

function safeFilename(value) {
  return String(value || "pinterest-media")
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "pinterest-media";
}

module.exports = {
  name: "pinterest",
  aliases: ["pin", "pindl"],
  description: "Download Pinterest videos and images",
  category: "Downloader",

  async execute({ sock, jid, message, text, args }) {
    const input = String(text || args?.join(" ") || "").trim();
    const url = input.match(/https?:\/\/\S+/i)?.[0]?.replace(/[)>.,]+$/, "");

    if (!url || !/(^|\.)((www|pin)\.)?pinterest\.com|(^|\.)pin\.it/i.test(new URL(url).hostname)) {
      return sock.sendMessage(
        jid,
        {
          text: "📌 *Pinterest Downloader*\n\nSend a Pinterest video or image link.\nExample: .pinterest https://pin.it/xxxxx"
        },
        { quoted: message }
      );
    }

    let tempFile;
    let statusMessage;
    const editStatus = async (status) => {
      if (statusMessage?.key) {
        await sock.sendMessage(jid, { text: status, edit: statusMessage.key });
      }
    };

    try {
      statusMessage = await sock.sendMessage(
        jid,
        { text: "📌 Fetching Pinterest media..." },
        { quoted: message }
      );

      const apiUrl = new URL("https://api.nexray.eu.cc/downloader/pinterest");
      apiUrl.searchParams.set("url", url);

      const apiResponse = await fetch(apiUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(60000)
      });

      if (!apiResponse.ok) throw new Error("Pinterest API returned HTTP " + apiResponse.status);
      const payload = await apiResponse.json();
      const result = payload?.result;

      if (payload?.status !== true || !result) {
        throw new Error("Pinterest API did not return media.");
      }

      const mediaUrl = result.video || result.image || result.media || result.url;
      if (typeof mediaUrl !== "string" || !/^https?:\/\//i.test(mediaUrl)) {
        throw new Error("No valid media URL was returned.");
      }

      const isVideo = Boolean(result.video) || /\.mp4(?:[?#]|$)/i.test(mediaUrl);
      const extension = isVideo ? ".mp4" : ".jpg";
      tempFile = path.join(
        os.tmpdir(),
        "galaxy-pinterest-" + Date.now() + "-" + Math.random().toString(16).slice(2) + extension
      );

      await editStatus("⬇️ Downloading: " + String(result.title || "Pinterest media"));

      const mediaResponse = await fetch(mediaUrl, {
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "*/*" },
        redirect: "follow",
        signal: AbortSignal.timeout(300000)
      });

      if (!mediaResponse.ok || !mediaResponse.body) {
        throw new Error("Media download failed (HTTP " + mediaResponse.status + ").");
      }

      await pipeline(Readable.fromWeb(mediaResponse.body), fs.createWriteStream(tempFile));
      const stats = fs.statSync(tempFile);
      if (!stats.size) throw new Error("Downloaded media is empty.");

      const title = String(result.title || "Pinterest media").slice(0, 180);
      const description = String(result.description || "").slice(0, 700);
      const caption = "📌 *" + title + "*" + (description ? "\n\n" + description : "");

      await editStatus("📤 Sending media...");

      if (isVideo) {
        await sock.sendMessage(
          jid,
          {
            video: { url: tempFile },
            mimetype: "video/mp4",
            fileName: safeFilename(title) + ".mp4",
            caption
          },
          { quoted: message }
        );
      } else {
        await sock.sendMessage(
          jid,
          {
            image: { url: tempFile },
            mimetype: "image/jpeg",
            caption
          },
          { quoted: message }
        );
      }

      await editStatus("✅ Pinterest download complete.");
    } catch (error) {
      console.error("[GALAXY-MD] Pinterest download failed:", error?.message || error);
      try {
        await editStatus("❌ Pinterest download failed. The API may be unavailable or this pin may not be downloadable.");
      } catch {
        await sock.sendMessage(
          jid,
          { text: "❌ Pinterest download failed. Please try again later." },
          { quoted: message }
        );
      }
    } finally {
      if (tempFile) {
        try { fs.unlinkSync(tempFile); } catch {}
      }
    }
  }
};
