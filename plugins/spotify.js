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
  description: "Search and download Spotify tracks, or download from a Spotify link",
  category: "Downloader",

  async execute({ sock, jid, message, text, args }) {
    const input = String(text || args?.join(" ") || "").trim();
    if (!input) {
      return sock.sendMessage(
        jid,
        {
          text: "🎵 *Spotify Downloader*\n\n• Search: .spotify Arz Kiya Hai\n• Link: .spotify https://open.spotify.com/track/xxxxx"
        },
        { quoted: message }
      );
    }

    const spotifyUrl = input.match(/https?:\/\/\S+/i)?.[0]?.replace(/[)>.,]+$/, "");
    const isSpotifyLink = Boolean(
      spotifyUrl && /(?:open\.)?spotify\.com\//i.test(spotifyUrl)
    );

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

    const editStatus = async (status) => {
      if (statusMessage?.key) {
        await sock.sendMessage(jid, { text: status, edit: statusMessage.key });
      }
    };

    try {
      statusMessage = await sock.sendMessage(
        jid,
        { text: isSpotifyLink ? "Getting Spotify track..." : "Searching Spotify..." },
        { quoted: message }
      );

      let apiUrl;
      if (isSpotifyLink) {
        apiUrl = new URL(API_BASE + "/spotify");
        apiUrl.searchParams.set("url", spotifyUrl);
      } else {
        apiUrl = new URL(API_BASE + "/spotifyplay");
        apiUrl.searchParams.set("q", input);
      }

      const apiResponse = await fetch(apiUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(60000)
      });

      if (!apiResponse.ok) {
        throw new Error("Spotify API returned HTTP " + apiResponse.status);
      }

      const payload = await apiResponse.json();
      if (payload?.status !== true || !payload?.result) {
        throw new Error("Spotify API did not return a track.");
      }

      const track = payload.result;
      const downloadUrl = isSpotifyLink ? track.url : track.download_url;

      if (typeof downloadUrl !== "string" || !/^https?:\/\//i.test(downloadUrl)) {
        throw new Error("Spotify did not return a valid download URL.");
      }

      const title = String(track.title || track.name || input);
      const artist = String(track.artist || "");
      await editStatus("Downloading: " + title);

      const downloadResponse = await fetch(downloadUrl, {
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "audio/*,*/*;q=0.8" },
        signal: AbortSignal.timeout(300000),
        redirect: "follow"
      });

      if (!downloadResponse.ok || !downloadResponse.body) {
        throw new Error("Audio download failed (HTTP " + downloadResponse.status + ").");
      }

      await pipeline(
        Readable.fromWeb(downloadResponse.body),
        fs.createWriteStream(tempFile)
      );

      const stats = fs.statSync(tempFile);
      if (!stats.size) throw new Error("Downloaded audio file is empty.");

      await editStatus("Sending audio...");

      await sock.sendMessage(
        jid,
        {
          audio: { url: tempFile },
          mimetype: "audio/mpeg",
          fileName: safeFilename(title) + ".mp3",
          ptt: false,
          contextInfo: {
            externalAdReply: {
              title: title.slice(0, 100),
              body: artist.slice(0, 100) || "Spotify",
              ...(track.thumbnail ? { thumbnailUrl: track.thumbnail } : {}),
              mediaType: 2,
              sourceUrl: track.url && /^https?:\/\//i.test(track.url) ? track.url : (isSpotifyLink ? spotifyUrl : "https://open.spotify.com/")
            }
          }
        },
        { quoted: message }
      );

      await editStatus("✅ Download complete: " + title + (artist ? "\nArtist: " + artist : ""));
    } catch (error) {
      console.error("[GALAXY-MD] Spotify download failed:", error?.message || error);
      try {
        await editStatus("❌ Spotify download failed. The API may be unavailable or the track could not be downloaded. Please try again.");
      } catch {
        await sock.sendMessage(
          jid,
          { text: "❌ Spotify download failed. Please try again later." },
          { quoted: message }
        );
      }
    } finally {
      try { fs.unlinkSync(tempFile); } catch {}
    }
  }
};
