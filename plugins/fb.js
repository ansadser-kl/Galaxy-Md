"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

module.exports = {
  name: "fb",
  aliases: [],
  description: "Download Facebook videos",
  category: "Downloader",
  async execute({ sock, jid, message, text, args }) {
    const input = String(text || args?.join(" ") || "").trim();
    const url = input.match(/https?:\/\/\S+/i)?.[0]?.replace(/[)>]+$/, "");

    if (!url || !/(facebook\.com|fb\.watch|fb\.com)/i.test(url)) {
      return sock.sendMessage(
        jid,
        { text: "Please provide a valid Facebook video link!\nExample: .fb https://www.facebook.com/share/v/xxxxx/" },
        { quoted: message }
      );
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "galaxy-fb-"));
    const statusMessage = await sock.sendMessage(jid, { text: "Downloading..." }, { quoted: message });
    const editStatus = async (status) => {
      if (statusMessage?.key) {
        return sock.sendMessage(jid, { text: status, edit: statusMessage.key });
      }
    };

    try {
      const response = await fetch("https://tryunsora.com/api/tools/download", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Origin": "https://tryunsora.com",
          "Referer": "https://tryunsora.com/"
        },
        body: JSON.stringify({ url, downloadMode: "auto" }),
        signal: AbortSignal.timeout(60000)
      });

      if (!response.ok) throw new Error("Facebook API returned HTTP " + response.status);
      const result = await response.json();

      if (!result?.url || !/^https?:\/\//i.test(result.url)) {
        throw new Error("Could not get a downloadable video from this Facebook link.");
      }

      const safeName = path.basename(String(result.filename || "facebook_video.mp4"))
        .replace(/[\\/:*?"<>|]/g, "_");
      const tempFile = path.join(tempDir, safeName);

      await editStatus("Sending...");
      const download = await fetch(result.url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(300000)
      });

      if (!download.ok || !download.body) {
        throw new Error("Video download failed (HTTP " + download.status + ")");
      }

      await pipeline(Readable.fromWeb(download.body), fs.createWriteStream(tempFile));
      const stats = fs.statSync(tempFile);
      if (!stats.size) throw new Error("Downloaded video is empty.");

      if (stats.size > 180 * 1024 * 1024) {
        await sock.sendMessage(jid, {
          document: { url: tempFile },
          mimetype: "video/mp4",
          fileName: safeName
        }, { quoted: message });
      } else {
        await sock.sendMessage(jid, {
          video: { url: tempFile },
          mimetype: "video/mp4",
          fileName: safeName
        }, { quoted: message });
      }

      await editStatus("Download complete!");
    } catch (error) {
      console.error("[GALAXY-MD] Facebook download failed:", error);
      try {
        await editStatus("Download failed!\n" + String(error?.message || error).slice(0, 200));
      } catch {
        await sock.sendMessage(jid, { text: "Download failed. Please try again." }, { quoted: message });
      }
    } finally {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  }
};
