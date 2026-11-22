"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const YTDLP_BIN = process.env.YTDLP_PATH || "yt-dlp";
const PROXY_LIMIT = Number(process.env.PROXY_LIMIT) || 70; // 50, 70, or 100
const PROXY_API_URL = (
  process.env.PROXY_API_URL || `https://proxies.xcasper.space/test?limit=${PROXY_LIMIT}`
).trim();
const MAX_PROXY_TRIES = 10; // Try top 10 fastest alive proxies
const YTDLP_COOKIES = (process.env.YTDLP_COOKIES || "").trim();

const pendingChoices = new Map();
const CHOICE_TTL = 10 * 60 * 1000;

function senderId(message, jid) {
  return message.key?.participant || message.key?.participantAlt || jid;
}

function getVideoId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.slice(1).split("/")[0] || "Unknown";
    if (parsed.pathname === "/watch") return parsed.searchParams.get("v") || "Unknown";
    const match = parsed.pathname.match(/\/(?:shorts|embed|live)\/([^/?]+)/);
    return match?.[1] || "Unknown";
  } catch {
    return "Unknown";
  }
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "Size unavailable";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return size.toFixed(unit === 0 ? 0 : 2) + " " + units[unit];
}

function safeFilename(value) {
  return String(value || "youtube-video")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 100) || "youtube-video";
}

function getLatencyMs(item) {
  if (Number.isFinite(Number(item?.latency_ms))) {
    return Number(item.latency_ms);
  }
  if (Number.isFinite(Number(item?.response_time))) {
    return Number(item.response_time) * 1000;
  }
  return Number.POSITIVE_INFINITY;
}

function buildProxyUrl(item) {
  if (!item || typeof item !== "object") return null;
  if (item.alive !== true) return null;
  if (!item.ip || !item.port) return null;

  const proto = String(item.type || item.protocol || "http").trim().toLowerCase();
  const auth =
    item.username && item.password
      ? `${encodeURIComponent(item.username)}:${encodeURIComponent(item.password)}@`
      : "";

  return `${proto}://${auth}${String(item.ip).trim()}:${String(item.port).trim()}`;
}

async function fetchFastestAliveProxies() {
  const res = await fetch(PROXY_API_URL, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0"
    },
    signal: AbortSignal.timeout(20000)
  });

  if (!res.ok) {
    throw new Error(`Proxy API failed with HTTP ${res.status}`);
  }

  const data = await res.json();
  const list = Array.isArray(data?.proxies) ? data.proxies : [];

  const aliveSorted = list
    .filter((item) => item && item.alive === true)
    .sort((a, b) => getLatencyMs(a) - getLatencyMs(b));

  const proxyUrls = [];
  const seen = new Set();

  for (const item of aliveSorted) {
    const proxyUrl = buildProxyUrl(item);
    if (proxyUrl && !seen.has(proxyUrl)) {
      seen.add(proxyUrl);
      proxyUrls.push({
        url: proxyUrl,
        latencyMs: getLatencyMs(item),
        ip: item.ip,
        port: item.port
      });
    }
    if (proxyUrls.length >= MAX_PROXY_TRIES) break;
  }

  return proxyUrls;
}

async function runYtDlpWithFastestProxy(url, extraArgs, options = {}) {
  const freshProxies = await fetchFastestAliveProxies();
  const candidates = [];
  const seen = new Set();

  // If a preferred proxy worked during metadata fetch, try it first
  if (options.preferredProxy?.url) {
    candidates.push(options.preferredProxy);
    seen.add(options.preferredProxy.url);
  }

  for (const proxy of freshProxies) {
    if (!seen.has(proxy.url)) {
      seen.add(proxy.url);
      candidates.push(proxy);
    }
  }

  if (!candidates.length) {
    throw new Error("No alive proxies returned by proxy API");
  }

  let lastError = null;

  for (const proxy of candidates) {
    const args = [
      "--no-warnings",
      "--no-playlist",
      "--socket-timeout",
      "15",
      "--proxy",
      proxy.url
    ];
    if (YTDLP_COOKIES) {
      args.push("--cookies", YTDLP_COOKIES);
    }
    args.push(...extraArgs, url);

    try {
      const result = await execFileAsync(YTDLP_BIN, args, {
        timeout: options.timeout || 25000,
        maxBuffer: options.maxBuffer || 25 * 1024 * 1024
      });
      return {
        ...result,
        usedProxy: proxy
      };
    } catch (err) {
      lastError = new Error(
        `Proxy ${proxy.ip}:${proxy.port} (${Math.round(proxy.latencyMs)}ms) failed: ${err?.message || "Unknown error"}`
      );
    }
  }

  throw lastError || new Error("All fast alive proxies failed in yt-dlp");
}

function extractQualityChoices(info) {
  const formats = Array.isArray(info?.formats) ? info.formats : [];
  const byHeight = new Map();

  for (const fmt of formats) {
    const height = Number(fmt?.height);
    const hasVideo = fmt?.vcodec && fmt.vcodec !== "none";
    if (!Number.isFinite(height) || height <= 0 || !hasVideo) continue;

    const rawSize = Number(fmt?.filesize || fmt?.filesize_approx || 0);
    const existing = byHeight.get(height);

    const scoreFmt = (f) => {
      let score = 0;
      if (f?.ext === "mp4") score += 10;
      if (f?.acodec && f.acodec !== "none") score += 5;
      if (Number(f?.filesize || f?.filesize_approx || 0) > 0) score += 3;
      return score;
    };

    if (!existing || scoreFmt(fmt) > scoreFmt(existing.fmt)) {
      byHeight.set(height, {
        height,
        quality: height + "p",
        size: rawSize > 0 ? formatBytes(rawSize) : "Size unavailable",
        fmt
      });
    }
  }

  return [...byHeight.values()]
    .sort((a, b) => b.height - a.height)
    .map(({ height, quality, size }) => ({ height, quality, size }));
}

module.exports = {
  name: "ytv",
  aliases: [],
  description: "Download YouTube video in selected quality using fastest alive proxy from API + yt-dlp",
  category: "Downloader",

  async execute({ sock, jid, message, text, args }) {
    const input = String(text || args?.join(" ") || "").trim();
    const url = input.match(/https?:\/\/\S+/i)?.[0]?.replace(/[)>]+$/, "");

    if (!url || !/(youtube\.com|youtu\.be)/i.test(url)) {
      return sock.sendMessage(
        jid,
        { text: "Please provide a valid YouTube link!\nExample: .ytv https://youtu.be/VIDEO_ID" },
        { quoted: message }
      );
    }

    try {
      await sock.sendMessage(
        jid,
        { text: "🔎 Fetching fastest alive proxy & video qualities..." },
        { quoted: message }
      );

      const { stdout, usedProxy } = await runYtDlpWithFastestProxy(url, ["--dump-single-json"], {
        timeout: 25000,
        maxBuffer: 25 * 1024 * 1024
      });

      const info = JSON.parse(stdout);
      const choices = extractQualityChoices(info);

      if (!choices.length) {
        throw new Error("No video formats found");
      }

      const videoId = info?.id || getVideoId(url);
      const title = String(info?.title || "YouTube video");
      const key = jid + ":" + senderId(message, jid);

      pendingChoices.set(key, {
        url,
        title,
        downloads: choices,
        preferredProxy: usedProxy,
        createdAt: Date.now()
      });

      const lines = choices.map(
        (item, index) => (index + 1) + ". " + item.quality + " — " + item.size
      );

      await sock.sendMessage(
        jid,
        {
          text:
            "🎬 *" + title.slice(0, 180) + "*\n" +
            "🆔 Video ID: " + videoId + "\n\n" +
            "📥 *Available video qualities*\n" +
            lines.join("\n") + "\n\n" +
            "Reply with the number of your preferred quality.\n" +
            "⏳ Selection expires in 10 minutes."
        },
        { quoted: message }
      );
    } catch (error) {
      console.error("[GALAXY-MD] .ytv metadata error:", error);
      await sock.sendMessage(
        jid,
        { text: "❌ Video quality list failed!\n" + (error?.message || "Unknown error") },
        { quoted: message }
      );
    }
  },

  async handleReply({ sock, jid, message, text }) {
    const choice = String(text || "").trim();
    if (!/^\d+$/.test(choice)) return false;

    const key = jid + ":" + senderId(message, jid);
    const pending = pendingChoices.get(key);
    if (!pending) return false;

    if (Date.now() - pending.createdAt > CHOICE_TTL) {
      pendingChoices.delete(key);
      await sock.sendMessage(
        jid,
        { text: "⌛ Quality selection expired. Please use .ytv again." },
        { quoted: message }
      );
      return true;
    }

    const index = Number(choice) - 1;
    if (index < 0 || index >= pending.downloads.length) {
      await sock.sendMessage(
        jid,
        { text: "❌ Invalid number. Reply with a number from 1 to " + pending.downloads.length + "." },
        { quoted: message }
      );
      return true;
    }

    const selected = pending.downloads[index];
    pendingChoices.delete(key);

    const tempBase = path.join(
      os.tmpdir(),
      "galaxy-ytv-" + Date.now() + "-" + Math.random().toString(16).slice(2)
    );
    const expectedOutput = tempBase + ".mp4";
    let statusMessage;

    const editStatus = async (status) => {
      try {
        if (statusMessage?.key) {
          await sock.sendMessage(jid, { text: status, edit: statusMessage.key });
        }
      } catch (err) {
        console.warn("[GALAXY-MD] Failed to edit .ytv status:", err?.message);
      }
    };

    try {
      statusMessage = await sock.sendMessage(
        jid,
        { text: "⬇️ Downloading " + selected.quality + " via fast proxy..." },
        { quoted: message }
      );

      const formatSelector =
        `bv*[height<=${selected.height}]+ba/b[height<=${selected.height}]/bv*+ba/b`;

      await runYtDlpWithFastestProxy(
        pending.url,
        [
          "-f",
          formatSelector,
          "--merge-output-format",
          "mp4",
          "-o",
          tempBase + ".%(ext)s"
        ],
        {
          preferredProxy: pending.preferredProxy,
          timeout: 300000,
          maxBuffer: 25 * 1024 * 1024
        }
      );

      const outputFile = fs.existsSync(expectedOutput)
        ? expectedOutput
        : fs
            .readdirSync(os.tmpdir())
            .map((name) => path.join(os.tmpdir(), name))
            .find((fullPath) => fullPath.startsWith(tempBase + ".") && fs.statSync(fullPath).size > 0);

      if (!outputFile || !fs.existsSync(outputFile)) {
        throw new Error("Downloaded file not found");
      }

      const stats = fs.statSync(outputFile);
      if (!stats.size) {
        throw new Error("Downloaded file is empty");
      }

      await editStatus("📤 Sending " + selected.quality + "...");
      const sizeLimit = 180 * 1024 * 1024;
      const filename = safeFilename(pending.title) + ".mp4";

      if (stats.size > sizeLimit) {
        await sock.sendMessage(
          jid,
          {
            document: { url: outputFile },
            mimetype: "video/mp4",
            fileName: filename
          },
          { quoted: message }
        );
      } else {
        await sock.sendMessage(
          jid,
          {
            video: { url: outputFile },
            mimetype: "video/mp4",
            fileName: filename
          },
          { quoted: message }
        );
      }

      await editStatus("✅ Video download complete!");
    } catch (error) {
      console.error("[GALAXY-MD] .ytv download error:", error);
      await editStatus("❌ Video download failed!\n" + (error?.message || "Unknown error"));
    } finally {
      try {
        const dirFiles = fs.readdirSync(os.tmpdir());
        for (const name of dirFiles) {
          if (name.startsWith(path.basename(tempBase))) {
            fs.unlinkSync(path.join(os.tmpdir(), name));
          }
        }
      } catch (err) {
        console.warn("[GALAXY-MD] Could not delete .ytv temp file:", err?.message);
      }
    }

    return true;
  }
};
