"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

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
        { text: "Please provide a valid YouTube link!\nExample: .yta https://youtu.be/VIDEO_ID\nAlias: .audio <YouTube URL>" },
        { quoted: message }
      );
    }

    const tempFile = path.join(os.tmpdir(), "galaxy-yta-" + Date.now() + "-" + Math.random().toString(16).slice(2) + ".mp3");
    let statusMessage;

    const editStatus = async (status) => {
      if (statusMessage?.key) {
        return sock.sendMessage(jid, { text: status, edit: statusMessage.key });
      }
    };

    try {
      statusMessage = await sock.sendMessage(jid, { text: "🎵 Downloading YouTube audio..." }, { quoted: message });

      const apiUrl = "https://jerrycoder.oggyapi.workers.dev/down/ytmp3?url=" + encodeURIComponent(url);
      const response = await fetch(apiUrl, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(60000)
      });

      if (!response.ok) throw new Error("YouTube audio API returned HTTP " + response.status);
      const result = await response.json();

      if (result?.status !== "success" || typeof result.url !== "string" || !/^https?:\/\//i.test(result.url)) {
        throw new Error("Could not get an MP3 download link for this video.");
      }

      const download = await fetch(result.url, {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "audio/mpeg,*/*" },
        signal: AbortSignal.timeout(300000)
      });

      if (!download.ok || !download.body) {
        throw new Error("MP3 download failed (HTTP " + download.status + ").");
      }

      await pipeline(Readable.fromWeb(download.body), fs.createWriteStream(tempFile));
      const stats = fs.statSync(tempFile);
      if (!stats.size) throw new Error("The downloaded audio file is empty.");

      await editStatus("📤 Sending MP3...");
      const safeTitle = String(result.title || "youtube-audio").replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 180) || "youtube-audio";

      await sock.sendMessage(jid, {
        audio: { url: tempFile },
        mimetype: "audio/mpeg",
        fileName: safeTitle + ".mp3",
        ptt: false
      }, { quoted: message });

      await editStatus("✅ Download complete!");
    } catch (error) {
      console.error("[GALAXY-MD] YouTube audio download failed:", error);
      try {
        await editStatus("❌ Download failed!\n" + String(error?.message || error).slice(0, 200));
      } catch {
        await sock.sendMessage(jid, { text: "❌ YouTube audio download failed. Please try again." }, { quoted: message });
      }
    } finally {
      try { fs.unlinkSync(tempFile); } catch {}
    }
  }
};
