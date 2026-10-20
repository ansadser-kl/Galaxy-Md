"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

module.exports = {
  name: "insta",
  aliases: [],
  description: "Download Instagram reels and videos",
  category: "Downloader",
  async execute({ sock, jid, message, text, args }) {
    const input = String(text || args?.join(" ") || "").trim();
    const url = input.match(/https?:\/\/\S+/i)?.[0]?.replace(/[)>]+$/, "");

    if (!url || !/(instagram\.com|instagr\.am)/i.test(url)) {
      return sock.sendMessage(
        jid,
        { text: "Please provide a valid Instagram link!\nExample: .insta https://www.instagram.com/reel/xxxxx/" },
        { quoted: message }
      );
    }

    const tempFile = path.join(os.tmpdir(), "galaxy-insta-" + Date.now() + "-" + Math.random().toString(16).slice(2) + ".mp4");
    let statusMessage;

    const editStatus = async (status) => {
      if (statusMessage?.key) {
        return sock.sendMessage(jid, { text: status, edit: statusMessage.key });
      }
    };

    try {
      statusMessage = await sock.sendMessage(jid, { text: "Downloading..." }, { quoted: message });

      const apiUrl = new URL("https://igexport.com/api/ig-reels/");
      apiUrl.searchParams.set("url", url);
      apiUrl.searchParams.set("videoOnly", "1");

      const response = await fetch(apiUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(60000)
      });

      if (!response.ok) throw new Error("Instagram API returned HTTP " + response.status);
      const result = await response.json();

      if (result?.ok !== true || typeof result?.media?.videoUrl !== "string") {
        throw new Error("Could not get a video from this Instagram link.");
      }

      const download = await fetch(result.media.videoUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(300000)
      });

      if (!download.ok || !download.body) {
        throw new Error("Video download failed (HTTP " + download.status + ").");
      }

      await pipeline(Readable.fromWeb(download.body), fs.createWriteStream(tempFile));
      const stats = fs.statSync(tempFile);
      if (!stats.size) throw new Error("The downloaded video is empty.");

      await editStatus("Sending...");

      const filename = String(result.media.filename || "instagram-video.mp4").replace(/[^a-zA-Z0-9._-]/g, "_");
      await sock.sendMessage(jid, {
        video: { url: tempFile },
        mimetype: "video/mp4",
        fileName: filename,
        caption: ""
      }, { quoted: message });

      await editStatus("Download complete!");
    } catch (error) {
      console.error("[GALAXY-MD] Instagram download failed:", error);
      try {
        await editStatus("Download failed!\n" + String(error?.message || error).slice(0, 200));
      } catch {
        await sock.sendMessage(jid, { text: "Download failed. Please try again." }, { quoted: message });
      }
    } finally {
      try { fs.unlinkSync(tempFile); } catch {}
    }
  }
};
