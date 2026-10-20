"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

module.exports = {
  name: "tera",
  aliases: [],
  description: "Download files from TeraBox links",
  category: "Downloader",
  async execute({ sock, jid, message, text, args }) {
    const input = String(text || args?.join(" ") || "").trim();
    const url = input.match(/https?:\/\/\S+/i)?.[0]?.replace(/[)>]+$/, "");

    if (!url || !/(terabox\.com|1024terabox\.com|teraboxapp\.com|terabox\.app|4funbox\.com)/i.test(url)) {
      return sock.sendMessage(
        jid,
        { text: "Please provide a valid TeraBox link!\nExample: .tera https://1024terabox.com/s/xxxxx" },
        { quoted: message }
      );
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "galaxy-tera-"));
    let statusMessage;

    const editStatus = async (status) => {
      if (statusMessage?.key) {
        return sock.sendMessage(jid, { text: status, edit: statusMessage.key });
      }
    };

    try {
      statusMessage = await sock.sendMessage(jid, { text: "Downloading..." }, { quoted: message });

      const response = await fetch("https://sechno.com/api/terabox", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Origin": "https://sechno.com",
          "Referer": "https://sechno.com/"
        },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(60000)
      });

      if (!response.ok) throw new Error("TeraBox API returned HTTP " + response.status);
      const result = await response.json();

      if (result?.success !== true || !Array.isArray(result?.files)) {
        throw new Error("Could not get files from this TeraBox link.");
      }

      const files = result.files.filter(file =>
        file && file.isDir !== true &&
        typeof file.downloadUrl === "string" &&
        /^https?:\/\//i.test(file.downloadUrl)
      );

      if (!files.length) throw new Error("No downloadable files were found.");

      await editStatus("Sending...");

      for (const [index, file] of files.entries()) {
        const safeName = path.basename(String(file.filename || "terabox-file")).replace(/[\\/:*?"<>|]/g, "_");
        const tempFile = path.join(tempDir, index + "-" + safeName);
        const download = await fetch(file.downloadUrl, {
          headers: { "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(300000)
        });

        if (!download.ok || !download.body) {
          throw new Error("File download failed (HTTP " + download.status + "): " + safeName);
        }

        await pipeline(Readable.fromWeb(download.body), fs.createWriteStream(tempFile));
        const stats = fs.statSync(tempFile);
        if (!stats.size) throw new Error("Downloaded file is empty: " + safeName);

        const caption = files.length > 1 ? safeName : undefined;
        if (stats.size > 180 * 1024 * 1024) {
          await sock.sendMessage(jid, {
            document: { url: tempFile },
            mimetype: "application/octet-stream",
            fileName: safeName,
            caption
          }, { quoted: message });
        } else if (/\.(mp4|m4v|mov|webm)$/i.test(safeName)) {
          await sock.sendMessage(jid, {
            video: { url: tempFile },
            mimetype: "video/mp4",
            fileName: safeName,
            ...(caption ? { caption } : {})
          }, { quoted: message });
        } else {
          await sock.sendMessage(jid, {
            document: { url: tempFile },
            mimetype: "application/octet-stream",
            fileName: safeName,
            caption
          }, { quoted: message });
        }
      }

      await editStatus("Download complete!");
    } catch (error) {
      console.error("[GALAXY-MD] TeraBox download failed:", error);
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
