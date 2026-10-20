"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

module.exports = {
  name: "spotify",
  aliases: [],
  description: "Download Spotify tracks",
  category: "Downloader",
  async execute({ sock, jid, message, text, args }) {
    const input = String(text || args?.join(" ") || "").trim();
    const url = input.match(/https?:\/\/\S+/i)?.[0]?.replace(/[)>]+$/, "");

    if (!url || !/open\.spotify\.com\/(track|album|playlist|intl-[^/]+\/(track|album|playlist))\//i.test(url)) {
      return sock.sendMessage(
        jid,
        { text: "Please provide a valid Spotify track, album, or playlist link!\nExample: .spotify https://open.spotify.com/track/xxxxx" },
        { quoted: message }
      );
    }

    const tempFile = path.join(os.tmpdir(), "galaxy-spotify-" + Date.now() + "-" + Math.random().toString(16).slice(2) + ".mp3");
    let statusMessage;

    const editStatus = async (status) => {
      if (statusMessage?.key) {
        return sock.sendMessage(jid, { text: status, edit: statusMessage.key });
      }
    };

    try {
      statusMessage = await sock.sendMessage(jid, { text: "Downloading..." }, { quoted: message });

      const response = await fetch("https://musicfab.io/api/spotify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Origin": "https://musicfab.io",
          "Referer": "https://musicfab.io/"
        },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(60000)
      });

      if (!response.ok) throw new Error("Spotify API returned HTTP " + response.status);
      const result = await response.json();
      const track = result?.data?.metadata;

      if (typeof track?.download !== "string" || !/^https?:\/\//i.test(track.download)) {
        throw new Error("Could not get a download link for this Spotify track.");
      }

      const download = await fetch(track.download, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(300000)
      });

      if (!download.ok || !download.body) {
        throw new Error("Audio download failed (HTTP " + download.status + ").");
      }

      await pipeline(Readable.fromWeb(download.body), fs.createWriteStream(tempFile));
      const stats = fs.statSync(tempFile);
      if (!stats.size) throw new Error("The downloaded audio is empty.");

      await editStatus("Sending...");

      await sock.sendMessage(jid, {
        audio: { url: tempFile },
        mimetype: "audio/mpeg",
        fileName: (String(track.name || "spotify-track").replace(/[\\/:*?"<>|]/g, "_") + ".mp3"),
        ptt: false
      }, { quoted: message });

      await editStatus("Download complete!");
    } catch (error) {
      console.error("[GALAXY-MD] Spotify download failed:", error);
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
