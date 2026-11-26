"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

let youtube;
try {
  youtube = require("youtube-sr").default || require("youtube-sr");
} catch (_) {}

const engine = require("./yt-engine");

// ---------- settings (all optional, set in .env) ----------
const envInt = (name, fallback) => {
  const value = parseInt(process.env[name], 10);
  return value > 0 ? value : fallback;
};
const MAX_DURATION_MIN = () => envInt("MAX_YT_DURATION", 60); // minutes
const MAX_SIZE_MB = () => envInt("MAX_YT_SIZE", 500); // MB
const MAX_JOBS = () => envInt("YT_CONCURRENCY", 2); // downloads running at once
const VIDEO_INLINE_LIMIT = 180 * 1024 * 1024; // bigger videos go out as a document

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

const stamp = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const uniqueTempPath = (name) => path.join(engine.TEMP_DIR, `${stamp()}_${name}`);

// leftovers from a crashed download (older than 1 hour)
(function cleanOldTemp() {
  try {
    const dir = engine.TEMP_DIR;
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const file of fs.readdirSync(dir)) {
      const full = path.join(dir, file);
      try {
        if (fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full, { recursive: true, force: true });
      } catch (_) {}
    }
  } catch (_) {}
})();

// ---------- tiny queue so a small panel is not flooded ----------
let active = 0;
const waiting = [];
async function limited(job) {
  if (active >= MAX_JOBS()) await new Promise((resolve) => waiting.push(resolve));
  else active++;
  try {
    return await job();
  } finally {
    const next = waiting.shift();
    if (next) next(); // hand the slot over
    else active--;
  }
}

// ---------- formatting ----------
function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

function formatDuration(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(Math.floor(s % 60)).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function formatViews(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) return "N/A";
  if (count >= 1e6) return (count / 1e6).toFixed(1) + "M";
  if (count >= 1e3) return (count / 1e3).toFixed(1) + "K";
  return String(count);
}

const cleanText = (value, max = 180) =>
  String(value ?? "").replace(/[\r\n]+/g, " ").replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);

const safeFileName = (title) =>
  String(title || "audio").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim().slice(0, 100) || "audio";

// ---------- links ----------
function youtubeUrlFrom(text) {
  const raw = String(text ?? "").match(/\bhttps?:\/\/\S+/i)?.[0];
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw.replace(/[)\]\.,!?>]*$/, ""));
  } catch (_) {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) return null;
  const [first, second] = url.pathname.split("/").filter(Boolean);
  let id = null;
  if (host.endsWith("youtu.be")) id = first;
  else if (first === "watch") id = url.searchParams.get("v");
  else if (["shorts", "live", "embed", "v"].includes(first)) id = second;
  return /^[\w-]{11}$/.test(id || "") ? `https://www.youtube.com/watch?v=${id}` : null;
}

const videoIdOf = (url) => String(url ?? "").match(/[?&]v=([\w-]{11})/)?.[1] ?? null;

function idFrom(input) {
  const text = String(input ?? "").trim();
  if (/^[\w-]{11}$/.test(text)) return text;
  const id = videoIdOf(youtubeUrlFrom(text) || text);
  if (!id) throw new Error("Not a YouTube video link");
  return id;
}

// ---------- limits ----------
function limitError(message) {
  const error = new Error(message);
  error.code = "YT_LIMIT";
  return error;
}

function assertWithinLimits(info, formats = []) {
  if (info?.isLive) throw limitError("Live streams cannot be downloaded.");
  const maxMinutes = MAX_DURATION_MIN();
  const maxMb = MAX_SIZE_MB();
  const seconds = Number(info?.lengthSeconds) || 0;
  if (seconds && seconds > maxMinutes * 60) {
    throw limitError(`Video is too long (${Math.ceil(seconds / 60)} min). The limit is ${maxMinutes} min.`);
  }
  const size = formats.reduce((total, f) => total + (Number(f?.size) || 0), 0);
  if (size > maxMb * 1024 * 1024) {
    throw limitError(`Video is too big (${formatBytes(size)}). The limit is ${maxMb} MB.`);
  }
}

// ---------- ffmpeg ----------
function runFfmpeg(args, timeout = 10 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const bin = process.env.FFMPEG_PATH || "ffmpeg";
    const child = spawn(bin, ["-hide_banner", "-loglevel", "error", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.on("error", (err) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        const missing = new Error("ffmpeg is not installed");
        missing.code = "YT_NO_FFMPEG";
        reject(missing);
      } else reject(err);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed (${signal || code}): ${stderr.trim().split("\n").slice(-3).join(" ")}`));
    });
  });
}

// ---------- info / download ----------
const heightOf = (quality) => parseInt(String(quality).match(/(\d+)p/)?.[1] || 0, 10);

async function getVideoInfo(url) {
  const videoId = idFrom(url);
  const info = await engine.getInfo(videoId);
  const { pickVideo, pickAudio, labelOf } = engine._internals;

  const labels = [...new Set(info.formats.filter((f) => f.hasVideo).map(labelOf).filter(Boolean))];
  const formats = labels
    .sort((a, b) => heightOf(b) - heightOf(a))
    .map((quality) => ({ type: "video", quality, size: pickVideo(info.formats, quality)?.size || 0 }));
  const audio = pickAudio(info.formats);
  if (audio) formats.push({ type: "audio", quality: audio.audioQuality, size: audio.size });

  return {
    videoId,
    title: info.title,
    lengthSeconds: info.duration || null,
    views: info.views,
    isLive: info.isLive,
    thumbnail: info.thumbnail,
    channel: { name: info.author },
    formats,
  };
}

// [{ quality, size }] best first, then { audio: true, size } when an audio stream exists
function qualityOptions(info) {
  const videos = (info.formats || []).filter((f) => f.type === "video" && f.quality);
  if (!videos.length) return null;
  const audio = (info.formats || []).find((f) => f.type === "audio");
  const audioSize = Number(audio?.size) || 0;
  const options = videos.map((f) => ({ quality: f.quality, size: f.size && audioSize ? f.size + audioSize : 0 }));
  if (audio) options.push({ audio: true, size: audioSize });
  return options;
}

async function muxTracks(dl, output) {
  await runFfmpeg([
    "-y", "-i", dl.videoPath, "-i", dl.audioPath,
    "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-movflags", "+faststart", output,
  ]);
}

async function downloadVideo(url, quality = "360p") {
  const info = await getVideoInfo(url);
  const target = /p$/i.test(quality) ? quality.toLowerCase() : `${quality}p`;
  const videos = info.formats.filter((f) => f.type === "video");
  assertWithinLimits(info, [
    videos.find((f) => f.quality === target) || videos.at(-1),
    info.formats.find((f) => f.type === "audio"),
  ]);

  return limited(async () => {
    const dl = await engine.download(info.videoId, "video", target);
    const output = uniqueTempPath("video.mp4");
    try {
      await muxTracks(dl, output);
    } catch (err) {
      await fs.promises.unlink(output).catch(() => {});
      throw err;
    } finally {
      await Promise.all([dl.videoPath, dl.audioPath].map((f) => fs.promises.unlink(f).catch(() => {})));
    }
    return { path: output, title: info.title, quality: dl.quality || target, playable: Boolean(dl.videoMime?.includes("avc1")) };
  });
}

async function downloadAudio(url, { best = false, onInfo } = {}) {
  const info = await getVideoInfo(url);
  assertWithinLimits(info, [info.formats.find((f) => f.type === "audio")]);
  if (onInfo) await onInfo(info);
  const dl = await limited(() => engine.download(info.videoId, "audio", undefined, { bestAudio: best }));
  return { path: dl.audioPath, title: info.title, info };
}

async function searchYoutube(query, limit = 10) {
  let results = [];
  if (youtube) {
    try {
      results = await youtube.search(query, { limit, type: "video" });
    } catch (err) {
      console.error("[GALAXY-MD] youtube-sr search failed, using Innertube:", err.message);
    }
  }
  if (!results?.length) return engine.search(query, limit);
  return results.map((video) => ({
    id: video.id,
    title: video.title,
    url: video.url,
    duration: video.durationFormatted,
    thumbnail: video.thumbnail?.url,
    views: video.views,
    uploadedAt: video.uploadedAt,
    channel: { name: video.channel?.name, url: video.channel?.url },
  }));
}

// ---------- audio tagging ----------
// only YouTube's own image hosts, https, no redirects
const COVER_HOSTS = [/(^|\.)ytimg\.com$/i, /(^|\.)ggpht\.com$/i, /(^|\.)googleusercontent\.com$/i];
function isCoverUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && COVER_HOSTS.some((re) => re.test(url.hostname));
  } catch (_) {
    return false;
  }
}

async function fetchCover(thumbnail, files) {
  try {
    if (!isCoverUrl(thumbnail)) return null;
    const res = await fetch(thumbnail, { signal: AbortSignal.timeout(10000), redirect: "error" });
    if (!res.ok || !String(res.headers.get("content-type")).startsWith("image/")) return null;
    const data = Buffer.from(await res.arrayBuffer());
    if (!data.length || data.length > 5 * 1024 * 1024) return null;
    const file = uniqueTempPath("cover.jpg");
    files.push(file);
    await fs.promises.writeFile(file, data);
    return file;
  } catch (_) {
    return null;
  }
}

// aac (.m4a) is stream-copied into a tagged m4a; opus (.webm) is encoded to mp3.
// toMp3 forces mp3 even for aac input. Falls back to the untouched file if ffmpeg fails.
async function tagAudio(input, tags, files, { toMp3 = false } = {}) {
  const aac = !input.endsWith(".webm") && !toMp3;
  const result = aac ? { ext: "m4a", mimetype: "audio/mp4" } : { ext: "mp3", mimetype: "audio/mpeg" };
  const original = input.endsWith(".webm")
    ? { path: input, ext: "webm", mimetype: "audio/webm", playable: false }
    : { path: input, ext: "m4a", mimetype: "audio/mp4", playable: true };

  const cover = tags.thumbnail ? await fetchCover(tags.thumbnail, files) : null;
  for (const withCover of cover ? [true, false] : [false]) {
    const output = uniqueTempPath(`audio.${result.ext}`);
    files.push(output);
    const args = ["-y", "-i", input];
    if (withCover) args.push("-i", cover);
    args.push("-map", "0:a");
    if (aac) args.push("-c:a", "copy");
    else args.push("-c:a", "libmp3lame", "-q:a", "2", "-id3v2_version", "3");
    if (withCover) {
      args.push("-map", "1:v");
      if (aac) args.push("-c:v", "copy", "-disposition:v:0", "attached_pic");
      else args.push("-c:v", "mjpeg", "-metadata:s:v", "title=Album cover", "-metadata:s:v", "comment=Cover (front)");
    }
    if (aac) args.push("-movflags", "+faststart");
    for (const key of ["title", "artist", "album"]) {
      if (tags[key]) args.push("-metadata", `${key}=${cleanText(tags[key], 200)}`);
    }
    args.push(output);
    try {
      await runFfmpeg(args);
      return { path: output, ...result, playable: true };
    } catch (err) {
      console.error("[GALAXY-MD] audio tagging failed:", err.message);
      if (err.code === "YT_NO_FFMPEG") break;
    }
  }
  return original;
}

// ---------- chat helpers ----------
function statusReporter(sock, jid, message, existing = null) {
  let sent = existing;
  return async (text) => {
    try {
      if (sent?.key) await sock.sendMessage(jid, { text, edit: sent.key });
      else sent = await sock.sendMessage(jid, { text }, { quoted: message });
    } catch (err) {
      console.warn("[GALAXY-MD] YouTube status update failed:", err?.message);
    }
  };
}

const removeFiles = (files) => Promise.all(files.map((file) => fs.promises.unlink(file).catch(() => {})));

function failureText(error) {
  if (error.code === "YT_LIMIT") return "⚠️ " + error.message;
  if (error.code === "YT_NO_FFMPEG") return "❌ ffmpeg is not installed on this server.";
  if (
    error.code === "ERR_MODULE_NOT_FOUND" || error.code === "MODULE_NOT_FOUND" ||
    /Cannot find (package|module) '(youtubei\.js|googlevideo|bgutils-js|jsdom)/i.test(String(error.message))
  ) {
    return "❌ YouTube downloader packages are missing. The owner needs to run npm install and restart.";
  }
  if (error.code === "YT_IP_BLOCKED") {
    return "❌ YouTube is blocking this server's IP address right now (HTTP 403).\nThis is often temporary, so try again later. If it keeps happening, this host's IP is flagged and another host or a VPS avoids it.";
  }
  if (error.code === "YT_LOGIN_REQUIRED") {
    return "❌ YouTube is asking this server to sign in.\nThe owner can fix this with the .ytlogin command.";
  }
  const message = error.primary || error.message || "";
  if (/LOGIN_REQUIRED|not a bot/i.test(message)) return "❌ YouTube refused the download (sign-in check). Try .ytlogin, or try again later.";
  if (/AGE_CHECK_REQUIRED|AGE_VERIFICATION_REQUIRED|confirm your age/i.test(message)) return "❌ This video is age-restricted.";
  if (/needs to be reloaded/i.test(message)) return "❌ YouTube rejected the request. Try again later.";
  if (/private video|video unavailable|has been removed|ERROR \(/i.test(message)) return "❌ This video is unavailable.";
  if (/Not a YouTube video link/i.test(message)) return "❌ That is not a valid YouTube video link.";
  return "❌ Download failed!";
}

// ctx = { sock, jid, message }
async function sendYoutubeAudio({ sock, jid, message }, url, { mp3 = false, best = false, say = null } = {}) {
  say = say || statusReporter(sock, jid, message);
  const files = [];
  try {
    const result = await downloadAudio(url, {
      best,
      onInfo: (info) => say(`⬇️ Downloading *${cleanText(info.title, 120)}*...`),
    });
    files.push(result.path);
    const tags = { title: result.title, artist: result.info?.channel?.name, thumbnail: result.info?.thumbnail };
    const audio = await tagAudio(result.path, tags, files, { toMp3: mp3 });
    await say("📤 Sending audio...");
    const fileName = `${safeFileName(result.title)}.${audio.ext}`;
    if (audio.playable) {
      await sock.sendMessage(jid, { audio: { url: audio.path }, mimetype: audio.mimetype, fileName, ptt: false }, { quoted: message });
    } else {
      // a raw .webm cannot play as a WhatsApp audio message
      await sock.sendMessage(jid, { document: { url: audio.path }, mimetype: audio.mimetype, fileName }, { quoted: message });
    }
    await say("✅ Download complete!");
    return true;
  } catch (error) {
    console.error("[GALAXY-MD] YouTube audio error:", error.message || error);
    await say(failureText(error));
    return false;
  } finally {
    await removeFiles(files);
  }
}

async function sendYoutubeVideo({ sock, jid, message }, url, quality = "360p", { say = null } = {}) {
  say = say || statusReporter(sock, jid, message);
  const files = [];
  try {
    await say(`⬇️ Downloading video at *${quality}*...`);
    const result = await downloadVideo(url, quality);
    files.push(result.path);
    const finalQuality = result.quality || quality;
    await say("📤 Uploading video...");
    const { size } = await fs.promises.stat(result.path);
    const fileName = `${safeFileName(result.title)}.mp4`;
    const caption = `${cleanText(result.title)}\nQuality: ${finalQuality}`;
    if (size > VIDEO_INLINE_LIMIT || !result.playable) {
      await sock.sendMessage(
        jid,
        {
          document: { url: result.path },
          mimetype: "video/mp4",
          fileName,
          caption: `${caption}\nSize: ${formatBytes(size)}`,
        },
        { quoted: message }
      );
    } else {
      await sock.sendMessage(jid, { video: { url: result.path }, mimetype: "video/mp4", fileName, caption }, { quoted: message });
    }
    await say("✅ Download complete!");
    return true;
  } catch (error) {
    console.error("[GALAXY-MD] YouTube video error:", error.message || error);
    await say(failureText(error));
    return false;
  } finally {
    await removeFiles(files);
  }
}

module.exports = {
  engine,
  youtubeUrlFrom,
  videoIdOf,
  getVideoInfo,
  qualityOptions,
  searchYoutube,
  tagAudio,
  isCoverUrl,
  downloadVideo,
  downloadAudio,
  sendYoutubeAudio,
  sendYoutubeVideo,
  statusReporter,
  failureText,
  assertWithinLimits,
  formatBytes,
  formatDuration,
  formatViews,
  cleanText,
};
