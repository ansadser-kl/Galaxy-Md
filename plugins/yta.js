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
      statusMessage = await sock.sendMessage(jid, { text: "🎵 Getting YouTube MP3 link..." }, { quoted: message });

      // Request a fresh MP3 link from pullmp3 immediately before downloading.
      const response = await fetch("https://pullmp3.cc/convert", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
          Origin: "https://pullmp3.cc",
          Referer: "https://pullmp3.cc/",
          "User-Agent": "Mozilla/5.0"
        },
        body: JSON.stringify({ url, format: "mp3" }),
        signal: AbortSignal.timeout(60000)
      });

      if (!response.ok) throw new Error("pullmp3 API returned HTTP " + response.status);
      const result = await response.json();
      const rawLink = result?.link;

      if (typeof rawLink !== "string" || !rawLink.trim()) {
        throw new Error("pullmp3 did not return a download link: " + JSON.stringify(result).slice(0, 180));
      }

      const downloadUrl = new URL(rawLink, "https://pullmp3.cc/").toString();
      if (!/^https?:$/.test(new URL(downloadUrl).protocol)) {
        throw new Error("pullmp3 returned an invalid download link.");
      }

      await editStatus("⬇️ Downloading MP3...");
      const download = await fetch(downloadUrl, {
        headers: {
          Referer: "https://pullmp3.cc/",
          Origin: "https://pullmp3.cc",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        },
        redirect: "follow",
        signal: AbortSignal.timeout(300000)
      });

      if (!download.ok || !download.body) {
        throw new Error("MP3 download failed (HTTP " + download.status + ").");
      }

      await pipeline(Readable.fromWeb(download.body), fs.createWriteStream(tempFile));
      const stats = fs.statSync(tempFile);
      if (!stats.size) throw new Error("The downloaded MP3 file is empty.");

      await editStatus("📤 Sending MP3...");
      const safeTitle = String(result.title || "youtube-audio")
        .replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 180) || "youtube-audio";

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
