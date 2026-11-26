"use strict";

// YouTube TV-login credentials, kept in a JSON file instead of a database.
// Location: YT_AUTH_FILE if set, otherwise yt-auth.json next to the session folder
// (so it sits on the same persistent volume, e.g. /data/yt-auth.json), otherwise <bot>/data/.
// Keep this file private.
const fs = require("fs");
const path = require("path");

function authFile() {
  if (process.env.YT_AUTH_FILE) return path.resolve(process.env.YT_AUTH_FILE);
  if (process.env.SESSION_DIR) return path.join(path.dirname(path.resolve(process.env.SESSION_DIR)), "yt-auth.json");
  return path.join(__dirname, "..", "data", "yt-auth.json");
}

const FILE = authFile();

const listeners = new Set();
let cached;
let running = null;

async function readFile() {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(FILE, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function writeFile(credentials) {
  await fs.promises.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = FILE + "." + process.pid + ".tmp";
  await fs.promises.writeFile(tmp, JSON.stringify(credentials), { mode: 0o600 });
  await fs.promises.rename(tmp, FILE);
}

async function getCredentials() {
  if (cached === undefined) cached = await readFile();
  return cached;
}

async function saveCredentials(credentials) {
  cached = credentials;
  await writeFile(credentials);
  listeners.forEach((fn) => fn(credentials));
}

async function logout() {
  cached = null;
  await fs.promises.rm(FILE, { force: true });
  listeners.forEach((fn) => fn(null));
}

const onCredentialsChange = (fn) => listeners.add(fn);

function login(onCode) {
  if (running) {
    running.code.then(onCode, () => {});
    return running.done;
  }
  let gotCode;
  const code = new Promise((resolve) => (gotCode = resolve));
  code.then(onCode, () => {});

  const done = (async () => {
    const { Innertube, UniversalCache } = await import("youtubei.js");
    const innertube = await Innertube.create({ cache: new UniversalCache(false), generate_session_locally: true });
    const session = innertube.session;
    return new Promise((resolve, reject) => {
      let timer;
      session.once("auth-pending", (data) => {
        gotCode(data);
        timer = setTimeout(
          () => reject(new Error("Login code expired. Run .ytlogin again.")),
          ((data.expires_in || 1800) + 15) * 1000
        );
      });
      session.once("auth", async ({ credentials }) => {
        clearTimeout(timer);
        await saveCredentials(credentials).catch((err) =>
          console.error("[GALAXY-MD] saving YouTube login failed:", err.message)
        );
        resolve(credentials);
      });
      session.once("auth-error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      session.signIn().catch(reject);
    });
  })().finally(() => {
    running = null;
  });

  running = { code, done };
  return done;
}

module.exports = { getCredentials, saveCredentials, logout, login, onCredentialsChange };
