// Galaxy-MD panel bootstrap: upload ONLY this file to the panel root, set the start
// command to "node start.js", and edit the settings below.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ===== your settings =====
const BOT_NUMBER      = "919876543210";   // country code + number, no +
const OWNER_NUMBER    = "919876543210";
const SUDO            = "";               // "919111111111,919222222222"
const MODE            = "public";         // public / private
const MAX_CLONES      = 4;                // numbers that can be linked with .pair (0 = off, max 8)
const PAIR_OWNER_ONLY = false;            // true = only owner/SUDO can use ".pair <number>"
const MAX_YT_DURATION = 60;               // longest YouTube video, in minutes
const MAX_YT_SIZE     = 500;              // biggest YouTube download, in MB
const REPO_URL        = "https://github.com/ansadser/Galaxy-Md";
const REPO_TARBALL    = "https://codeload.github.com/ansadser/Galaxy-Md/tar.gz/refs/heads/main";
const AUTO_UPDATE     = true;             // true = take the latest code from GitHub on every start
// =========================

const ROOT = __dirname;
const BIN_DIR = path.join(ROOT, 'bin');
const FFMPEG_BIN = path.join(BIN_DIR, 'ffmpeg');
const BOT_DIR = path.join(ROOT, 'Galaxy-Md');
const TEMP_DIR = path.join(ROOT, 'temp');
// Kept OUTSIDE the bot folder, so updates never touch them:
//   session/ (main login), session2.. (clone bots), yt-auth.json (YouTube login)
const SESSION_DIR = path.join(ROOT, 'session');

if (parseInt(process.versions.node, 10) < 20) {
  console.error('❌ Node.js 20 or newer is required (this panel runs ' + process.versions.node + '). Pick Node 20/22 in the panel settings.');
  process.exit(1);
}

if (!/^\d{8,15}$/.test(BOT_NUMBER)) {
  console.error('❌ BOT_NUMBER is not valid. Digits only, with country code (example: 919876543210).');
  process.exit(1);
}

function run(command, options = {}) {
  try {
    execSync(command, { stdio: 'inherit', ...options });
  } catch (error) {
    console.error('❌ Error running command: ' + command);
    process.exit(1);
  }
}

function tryRun(command, options = {}) {
  try {
    execSync(command, { stdio: 'inherit', ...options });
    return true;
  } catch {
    return false;
  }
}

// ---------- FFmpeg (+ ffprobe) ----------
fs.mkdirSync(BIN_DIR, { recursive: true });

if (!fs.existsSync(FFMPEG_BIN)) {
  console.log('🔧 Downloading FFmpeg...');
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const url = 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-' + arch + '-static.tar.xz';
  const tmpTar = path.join(ROOT, 'ffmpeg.tar.xz');
  run('curl -L ' + url + ' -o "' + tmpTar + '"');
  run('tar -xf "' + tmpTar + '" -C "' + ROOT + '"');
  const ffmpegDir = fs.readdirSync(ROOT).find(d => /^ffmpeg-.*-static$/.test(d));
  if (!ffmpegDir) {
    console.error('❌ FFmpeg folder not found after extracting.');
    process.exit(1);
  }
  for (const tool of ['ffmpeg', 'ffprobe']) {
    const from = path.join(ROOT, ffmpegDir, tool);
    if (fs.existsSync(from)) {
      fs.renameSync(from, path.join(BIN_DIR, tool));
      run('chmod +x "' + path.join(BIN_DIR, tool) + '"');
    }
  }
  run('rm -rf "' + tmpTar + '" "' + path.join(ROOT, ffmpegDir) + '"');
  console.log('✅ FFmpeg ready.');
} else {
  console.log('⚡ FFmpeg already exists.');
}

// every plugin finds ffmpeg through PATH / FFMPEG_PATH
process.env.PATH = BIN_DIR + path.delimiter + process.env.PATH;
process.env.FFMPEG_PATH = FFMPEG_BIN;

// ---------- Bot code ----------
function downloadTarball() {
  fs.mkdirSync(BOT_DIR, { recursive: true });
  const tgz = path.join(ROOT, 'galaxy.tar.gz');
  run('curl -L ' + REPO_TARBALL + ' -o "' + tgz + '"');
  run('tar -xzf "' + tgz + '" -C "' + BOT_DIR + '" --strip-components=1');
  run('rm -f "' + tgz + '"');
}

const pkgPath = path.join(BOT_DIR, 'package.json');
let pkgBefore = '';
if (fs.existsSync(pkgPath)) pkgBefore = fs.readFileSync(pkgPath, 'utf8');

if (!fs.existsSync(path.join(BOT_DIR, 'index.js'))) {
  console.log('📥 Downloading Galaxy-Md...');
  fs.rmSync(BOT_DIR, { recursive: true, force: true });
  if (!tryRun('git clone --depth 1 ' + REPO_URL + ' "' + BOT_DIR + '"')) {
    console.log('⚠️ git did not work, trying the tarball...');
    fs.rmSync(BOT_DIR, { recursive: true, force: true });
    downloadTarball();
  }
} else if (AUTO_UPDATE) {
  console.log('🔄 Checking GitHub for updates...');
  if (fs.existsSync(path.join(BOT_DIR, '.git'))) {
    if (!tryRun('git pull --ff-only', { cwd: BOT_DIR })) {
      console.log('⚠️ git pull failed (local changes?). Using the current code.');
    }
  } else {
    const tgz = path.join(ROOT, 'galaxy.tar.gz');
    const ok = tryRun('curl -L ' + REPO_TARBALL + ' -o "' + tgz + '"') &&
      tryRun('tar -xzf "' + tgz + '" -C "' + BOT_DIR + '" --strip-components=1');
    tryRun('rm -f "' + tgz + '"');
    if (!ok) console.log('⚠️ Update failed. Using the current code.');
  }
} else {
  console.log('⏭️ AUTO_UPDATE is off. Using the current code.');
}

let pkgAfter = '';
if (fs.existsSync(pkgPath)) pkgAfter = fs.readFileSync(pkgPath, 'utf8');
const packageChanged = pkgBefore !== pkgAfter;

try {
  process.chdir(BOT_DIR);
} catch {
  console.error('❌ Could not enter the Galaxy-Md folder!');
  process.exit(1);
}

// ---------- Dependencies ----------
const depsMissing = !fs.existsSync('./node_modules/baileys') || !fs.existsSync('./node_modules/youtubei.js');
if (depsMissing || packageChanged) {
  console.log('📦 Installing dependencies (the first time can take a few minutes)...');
  run('npm install --omit=dev --no-audit --no-fund');
} else {
  console.log('⚡ Dependencies already installed.');
}

// ---------- .env ----------
console.log('🔐 Writing .env...');
fs.mkdirSync(SESSION_DIR, { recursive: true });
fs.mkdirSync(TEMP_DIR, { recursive: true });
const envLines = [
  'BOT_NUMBER="' + BOT_NUMBER + '"',
  'OWNER_NUMBER="' + OWNER_NUMBER + '"',
  'SUDO="' + SUDO + '"',
  'MODE="' + MODE + '"',
  'SESSION_DIR="' + SESSION_DIR + '"',
  'TEMP_DIR="' + TEMP_DIR + '"',
  'FFMPEG_PATH="' + FFMPEG_BIN + '"',
  'MAX_CLONES=' + MAX_CLONES,
  'PAIR_OWNER_ONLY=' + PAIR_OWNER_ONLY,
  'MAX_YT_DURATION=' + MAX_YT_DURATION,
  'MAX_YT_SIZE=' + MAX_YT_SIZE,
];
fs.writeFileSync('.env', envLines.join('\n') + '\n');

// ---------- Start ----------
console.log('🚀 Starting Galaxy-MD...');
console.log('📲 First start: a PAIRING CODE appears here. WhatsApp → Linked devices → Link with phone number.');
run('npm start');
