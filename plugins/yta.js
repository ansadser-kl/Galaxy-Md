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
        {
          text: "Please provide a valid YouTube link!\nExample: .yta https://youtu.be/VIDEO_ID\nAlias: .audio <YouTube URL>"
        },
        { quoted: message }
      );
    }

    const tempFile = path.join(
      os.tmpdir(),
      "galaxy-yta-" + Date.now() + "-" +
      Math.random().toString(16).slice(2) + ".mp3"
    );

    let statusMessage;

    const editStatus = async (status) => {
      try {
        if (statusMessage?.key) {
          await sock.sendMessage(jid, {
            text: status,
            edit: statusMessage.key
          });
        }
      } catch (err) {
        console.warn("[GALAXY-MD] Failed to edit status message:", err?.message);
      }
    };

    try {
      statusMessage = await sock.sendMessage(
        jid,
        { text: "🎵 Requesting YouTube conversion..." },
        { quoted: message }
      );

      const commonHeaders = {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://pullmp3.cc/",
        Origin: "https://pullmp3.cc"
      };

      // 1. Initial convert request
      const initResponse = await fetch("https://pullmp3.cc/convert", {
        method: "POST",
        headers: {
          ...commonHeaders,
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest"
        },
        body: JSON.stringify({
          url,
          format: "mp3"
        }),
        signal: AbortSignal.timeout(30000)
      });

      if (!initResponse.ok) {
        throw new Error(`Conversion API returned HTTP ${initResponse.status}`);
      }

      const initResult = await initResponse.json();

      if (!initResult?.success) {
        throw new Error(initResult?.message || "Server rejected conversion request.");
      }

      let downloadUrl = "";
      let title = initResult?.title || "youtube-audio";

      // 2. Check if instant download link was provided (Backup API)
      if (typeof initResult.link === "string" && initResult.link.trim()) {
        downloadUrl = initResult.link.trim();
      } 
      // 3. Otherwise, poll the /progress endpoint (Primary API)
      else if (initResult.progress_id) {
        const { progress_id, video_id, log_id } = initResult;
        const maxAttempts = 35;
        const pollDelayMs = 2500;
        let isComplete = false;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          await editStatus(`⏳ Converting audio... (${Math.min(attempt * 3, 95)}%)`);
          await new Promise((resolve) => setTimeout(resolve, pollDelayMs));

          const pollUrl = new URL("https://pullmp3.cc/progress");
          pollUrl.searchParams.set("progress_id", progress_id);
          pollUrl.searchParams.set("format", "mp3");
          if (video_id) pollUrl.searchParams.set("video_id", video_id);
          if (log_id) pollUrl.searchParams.set("log_id", log_id);

          const pollRes = await fetch(pollUrl.toString(), {
            headers: {
              ...commonHeaders,
              Accept: "application/json",
              "X-Requested-With": "XMLHttpRequest"
            },
            signal: AbortSignal.timeout(15000)
          });

          if (!pollRes.ok) continue;

          const pollData = await pollRes.json();

          if (pollData?.data?.failed) {
            throw new Error("Conversion failed on provider server.");
          }

          if (pollData?.data?.finished && pollData?.data?.downloadUrl) {
            downloadUrl = pollData.data.downloadUrl;
            if (pollData.data.title) title = pollData.data.title;
            isComplete = true;
            break;
          }
        }

        if (!isComplete || !downloadUrl) {
          throw new Error("Timed out waiting for MP3 conversion to finish.");
        }
      } else {
        throw new Error("Unrecognized response format from conversion service.");
      }

      await editStatus("⬇️ Downloading MP3...");

      // 4. Download file from CDN
      const downloadRes = await fetch(downloadUrl, {
        headers: commonHeaders,
        redirect: "follow",
        signal: AbortSignal.timeout(180000)
      });

      if (!downloadRes.ok || !downloadRes.body) {
        throw new Error(`File download failed (HTTP ${downloadRes.status}).`);
      }

      await pipeline(
        Readable.fromWeb(downloadRes.body),
        fs.createWriteStream(tempFile)
      );

      const stats = fs.statSync(tempFile);
      if (!stats.size) {
        throw new Error("The downloaded MP3 file is empty.");
      }

      await editStatus("📤 Uploading MP3...");

      const safeTitle = String(title)
        .replace(/[\\/:*?"<>|]/g, "_")
        .trim()
        .slice(0, 100) || "audio";

      await sock.sendMessage(
        jid,
        {
          audio: { url: tempFile },
          mimetype: "audio/mpeg",
          fileName: `${safeTitle}.mp3`,
          ptt: false
        },
        { quoted: message }
      );

      await editStatus("✅ Download complete!");

    } catch (error) {
      console.error("[GALAXY-MD] YouTube audio download error:", error);

      try {
        await editStatus(
          "❌ Download failed!\n" +
          String(error?.message || error).slice(0, 180)
        );
      } catch {
        await sock.sendMessage(
          jid,
          { text: "❌ YouTube audio download failed. Please try again." },
          { quoted: message }
        );
      }

    } finally {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      } catch (err) {
        console.warn("[GALAXY-MD] Could not delete temp file:", err?.message);
      }
    }
  }
};
