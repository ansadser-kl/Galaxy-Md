"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

const API_BASE = "https://api.nexray.eu.cc/downloader";

function safeFilename(value) {
  return String(value || "spotify-track")
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150) || "spotify-track";
}

module.exports = {
  name: "spotify",
  aliases: ["spotifyplay"],
  description: "Search and download Spotify tracks as plain MP3 audio",
  category: "Downloader",

  async execute({ sock, jid, message, text, args }) {
    const input = String(text || args?.join(" ") || "").trim();
    if (!input) {
      return sock.sendMessage(
        jid,
        {
          text: "*Spotify Downloader*\n\n• Search: .spotify Arz Kiya Hai\n• Link: .spotify https://open.spotify.com/track/xxxxx"
        },
        { quoted: message }
      );
    }

    const spotifyUrl = input.match(/https?:\/\/\S+/i)?.[0]?.replace(/[)>.,]+$/, "");
    const isSpotifyLink = Boolean(spotifyUrl && /(?:open\.)?spotify\.com\//i.test(spotifyUrl));

    if (spotifyUrl && !isSpotifyLink) {
      return sock.sendMessage(
        jid,
        { text: "Please send a valid Spotify link or a song name to search." },
        { quoted: message }
      );
    }

    const tempFile = path.join(
      os.tmpdir(),
      "galaxy-spotify-" + Date.now() + "-" + Math.random().toString(16).slice(2) + ".mp3"
    );
    let statusMessage;

    const editStatus = async status => {
      try {
        if (statusMessage?.key) {
          await sock.sendMessage(jid, { text: status, edit: statusMessage.key });
        }
      } catch (error) {
        console.warn("[GALAXY-MD] Failed to edit Spotify status:", error?.message);
      }
    };

    try {
      statusMessage = await sock.sendMessage(
        jid,
        { text: isSpotifyLink ? "Getting Spotify track..." : "Searching Spotify..." },
        { quoted: message }
      );

      const apiUrl = new URL(API_BASE + (isSpotifyLink ? "/spotify" : "/spotifyplay"));
      apiUrl.searchParams.set(isSpotifyLink ? "url" : "q", isSpotifyLink ? spotifyUrl : input);

      const apiResponse = await fetch(apiUrl, {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
        signal: AbortSignal.timeout(60000)
      });
      if (!apiResponse.ok) throw new Error("API error");

      const payload = await apiResponse.json();
      const track = payload?.result;
      if (payload?.status !== true || !track) throw new Error("API error");

      // Search response uses download_url; link response uses result.url as the direct audio URL.
      const downloadUrl = isSpotifyLink ? track.url : track.download_url;
      if (typeof downloadUrl !== "string" || !/^https?:\/\//i.test(downloadUrl)) {
        throw new Error("API error");
      }

      const title = String(track.title || track.name || input).trim().slice(0, 180);
      await editStatus("Downloading MP3...");

      const downloadResponse = await fetch(downloadUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "audio/mpeg,audio/*;q=0.9,*/*;q=0.8"
        },
        signal: AbortSignal.timeout(300000),
        redirect: "follow"
      });
      if (!downloadResponse.ok || !downloadResponse.body) throw new Error("API error");

      await pipeline(
        Readable.fromWeb(downloadResponse.body),
        fs.createWriteStream(tempFile)
      );
      if (!fs.statSync(tempFile).size) throw new Error("API error");

      await editStatus("Sending MP3 file...");

      await sock.sendMessage(
        jid,
        {
          audio: { url: tempFile },
          mimetype: "audio/mpeg",
          fileName: safeFilename(title) + ".mp3",
          ptt: false
        },
        { quoted: message }
      );

      await editStatus("Spotify MP3 sent successfully!");
    } catch (error) {
      console.error("[GALAXY-MD] Spotify download failed:", error?.message || error);
      await editStatus("Spotify download failed.\nAPI error");
    } finally {
      try { fs.unlinkSync(tempFile); } catch {}
    }
  }
};
