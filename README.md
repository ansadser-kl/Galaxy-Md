# GALAXY-MD 🚀

A fast, plugin-based **WhatsApp bot** built on **Baileys** with **CommonJS plugin files**. It runs on Android (Termux), VPS / cloud hosting (PM2, Docker, Railway) and PC.

**GitHub:** https://github.com/ansadser/Galaxy-Md

## Features

- **Pairing-code login:** link the bot with a code, no QR scan needed.
- **Session persistence:** the login is saved in `session/` and reused after restarts.
- **Bot cloning (multi-session):** run up to 4 WhatsApp accounts in one deployment with `.pair <number>`. Each clone has its own session folder. Logged-out sessions are deleted automatically.
- **Auto-reconnect** after temporary network drops.
- **Modular plugins:** every command is a separate `.js` file inside `plugins/`.
- **Downloaders:** YouTube (video, audio, quality list, search), Spotify, Instagram, Facebook, TikTok, Pinterest, X/Twitter and TeraBox, with automatic fallback between several APIs.
- **Media tools:** MP3 converter, animated sticker to MP4, black-screen video, trim / slow / speed / bass, song finder, AI image upscale, file to link.
- **Group tools:** tag members, kick, promote, demote, welcome / goodbye messages, anti-link.
- **Auto view-once:** view-once photos, videos and voice notes are sent to the owner number.
- **Call play (experimental):** the bot calls you on WhatsApp and plays a song.
- **Access control:** `.mode public` for everyone, `.mode private` for the bot, owner and SUDO numbers only.

## Requirements

- **Node.js 18 or newer** (Node 20 recommended).
- **FFmpeg** for the audio and video commands.
- **webp tools** (`anim_dump`) for the `.mp4` command only.
- A WhatsApp number to use as the bot.

## Installation

### 1. Install the tools

**Termux (Android):**

```bash
pkg update -y && pkg upgrade -y
pkg install -y nodejs git ffmpeg libwebp
```

**Ubuntu / Debian VPS:**

```bash
sudo apt update && sudo apt install -y git ffmpeg webp curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2. Get the code and install packages

```bash
git clone https://github.com/ansadser/Galaxy-Md.git
cd Galaxy-Md
npm install --omit=dev
```

### 3. Create the `.env` file

```bash
cp .env.example .env
nano .env
```

Set at least `BOT_NUMBER` (country code first, no `+`):

```env
BOT_NUMBER="919876543210"
OWNER_NUMBER="919876543210"
SUDO="919111111111,919222222222"
MODE="public"
```

### 4. Start the bot

```bash
npm start
```

The first start prints a **pairing code**. In WhatsApp open **Linked devices → Link with phone number** and enter the code within about 30 seconds. After linking, keep the `session/` folder, so the bot stays logged in.

> A pairing code is requested only when the saved session is not registered.

### 5. Keep it running with PM2

```bash
npm i -g pm2
pm2 start index.js --name Galaxy-Md
pm2 save
pm2 logs Galaxy-Md
```

## Environment variables

Put these in `.env` (or in the Variables panel of your host, for example Railway). Never commit the `.env` file.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `BOT_NUMBER` | Yes | none | WhatsApp number of the bot, with country code and no `+` (example `919876543210`). |
| `OWNER_NUMBER` | No | `BOT_NUMBER` | Owner number. Used for owner-only commands and as the target of auto view-once. |
| `SUDO` | No | none | Comma-separated extra admins who can use commands in private mode. |
| `MODE` | No | `public` | `public` for everyone, `private` for owner and SUDO only. Change it later with `.mode`. |
| `BOT_NAME` | No | `GALAXY-MD` | Name shown by the bot. |
| `PREFIX` | No | `.` | Command prefix. Change it later with `.setprefix`. |
| `SESSION_DIR` | No | `./session` | Folder for the WhatsApp login. Clones use `session2`, `session3`, ... next to it. On Railway use a persistent volume, for example `/data/session`. |
| `MAX_SESSIONS` | No | `4` | Total live WhatsApp accounts per deployment: main bot + clones. `4` means main + up to 3 clones. `MAX_PAIRS` is accepted as an alias. |
| `WA_BROWSER` | No | `android` | Linked-device type. `android` is needed for view-once media. Use `chrome` if linking fails, `safari` for Safari. |
| `FFMPEG_PATH` | No | `ffmpeg` | Full path of FFmpeg if it is not on `PATH`. |
| `FFPROBE_PATH` | No | `ffprobe` | Full path of `ffprobe`, used by `.callplay` to end the call when the song finishes. |
| `ANIM_DUMP_PATH` | No | `anim_dump` | Full path of `anim_dump` (webp tools), used by `.mp4`. |
| `MUSIC_FINDER_URL` | No | built-in service | Song recognition API used by `.find`. |
| `CALL_PLAY_PUBLIC` | No | `false` | `true` lets everyone use `.callplay`. By default only owner and SUDO can. |
| `CALL_AUTH_DIR` | No | `./call-session` | Separate WhatsApp session used for voice calls. |
| `CALL_MAX_MS` | No | `600000` | Maximum call length in milliseconds. |
| `CALL_RING_TIMEOUT_MS` | No | `45000` | The bot hangs up if nobody answers in this time. |
| `CALL_COOLDOWN_MS` | No | `120000` | Cooldown per user when `CALL_PLAY_PUBLIC=true`. |

The bot also saves settings changed from WhatsApp (owner, prefix, SUDO, bot name) in `galaxy-data.json`, and the mode in `mode.json`. These saved values win over `.env`.

## Commands

The default prefix is `.`. Send `.menu` inside WhatsApp to see the list. Commands marked **reply** work on a message you reply to.

### General

| Command | What it does |
| --- | --- |
| `.menu` `.help` `.commands` | Show the command menu |
| `.alive` | Bot status, uptime, owner and mode |
| `.info` | Version, mode, prefix and plugin count |
| `.ping` | Check the response speed |
| `.runtime` `.uptime` | Show the uptime |
| `.owner` | Send the owner contact card |
| `.repo` `.github` | Show the source repository |
| `.weather <city>` | Current weather |
| `.jid` | Show the JID of the current chat |

### Downloaders

| Command | What it does |
| --- | --- |
| `.video <link>` | YouTube video as MP4 |
| `.ytv <link>` | YouTube video, choose the quality by number |
| `.yta` `.audio <link>` | YouTube audio as MP3 |
| `.play` `.song <name>` | Search YouTube and send the MP3 |
| `.yts` `.ytsearch <name>` | Search YouTube and pick audio or video |
| `.spotify` `.spotifyplay <name>` | Spotify track as MP3 |
| `.insta <link>` | Instagram reels and videos |
| `.fb` `.facebook <link>` | Facebook videos |
| `.tiktok` `.tt <link>` | TikTok videos without watermark |
| `.pinterest` `.pin <link>` | Pinterest images and videos |
| `.twitter` `.x` `.tweet` `.twitdl <link>` | X/Twitter videos and images |
| `.tera <link>` | TeraBox files |
| `.autodl on/off` | Auto download Instagram, Facebook, TeraBox and Spotify links (owner) |

### Media tools

| Command | What it does |
| --- | --- |
| `.sticker` | **Reply** to an image or short video to make a sticker |
| `.mp3` | **Reply** to a video, audio, voice note, m4a or document to get an MP3 |
| `.mp4` | **Reply** to an animated sticker to get an MP4 |
| `.black` | **Reply** to an audio to get a black-screen MP4 video |
| `.trim <start> <end>` | **Reply** to an audio and cut it by seconds |
| `.slow [0.5-0.99]` `.speed [0.5-2.0]` | **Reply** to an audio and change its speed |
| `.bass [1-30]` | **Reply** to an audio for a bass boost |
| `.vn` | **Reply** to an audio file to send it as a voice note |
| `.find` `.shazam` | **Reply** to an audio or video to find the song |
| `.upscale [2-6]` `.hd` | **Reply** to an image for AI upscale (or `.upscale <image-url>`) |
| `.url` | **Reply** to a file, or give a link, to get a download link |
| `.vv` | **Reply** to a view-once message to retrieve the media |
| `.callplay <song>` `.callsong` `.cplay` | The bot calls you and plays the song. `.callplay stop` ends the call |

### Group

| Command | What it does |
| --- | --- |
| `.tag all` / `.tag admin` / `.tag <text>` | Tag everyone, only admins, or send a text that tags everyone (reply works too) |
| `.kick` `.remove` | Remove a member by reply or mention (admins) |
| `.promote` `.demote` | Promote or demote a member (admins) |
| `.welcome on/off/status` | Welcome messages for new members (admins) |
| `.goodbye on/off/status` | Goodbye messages (admins) |
| `.testwelcome` `.testgoodbye` | Preview the welcome and goodbye messages |
| `.antilink on/off/status` | Anti-link protection for the group (admins) |
| `.admins` | List the group admins |
| `.getjids` | Show the group and member JIDs |

### Owner and utilities

| Command | What it does |
| --- | --- |
| `.autovv on/off/status` | Auto forward view-once media to the owner number |
| `.mode public/private` | Switch the bot access |
| `.setprefix` `.setbot` `.setowner` | Change the prefix, bot name or owner (owner / SUDO) |
| `.setsudo` `.getsudo` `.delsudo` | Manage SUDO numbers (owner / SUDO) |
| `.setimage <URL>` `.setvideo <URL>` | Save an image or video URL for the bot (owner / SUDO) |
| `.reboot` | Restart the bot process (owner / SUDO) |
| `.pair <number>` | Create a clone with its own pairing code (owner / SUDO) |
| `.unpair <number\|slot\|all>` | Stop a clone, delete its session folder and free the slot (owner / SUDO) |
| `.sessions` | List live sessions, their numbers and status (owner / SUDO) |
| `.send number\|message` | Send a message to a number (owner / SUDO) |
| `.forward number` | **Reply** to a message to forward it to a number |
| `.fd <jid>` | **Reply** to an audio to send it as a voice note to a JID or channel |
| `.save` | **Reply** to a message to get it in your private chat |

The bot also answers with a random voice note when the bot or the owner is mentioned in a group.

## Auto view-once

`.autovv` is on by default. Every view-once photo, video or voice note that reaches the bot is sent to the owner number, and the sender is mentioned in the caption. Use `.autovv off` to stop it and `.autovv status` to see the state.

WhatsApp sends view-once media only to Android-type linked devices, so keep `WA_BROWSER=android` (the default). If the bot was linked with another type, delete the `session/` folder and link again.

## Bot cloning (multi-session)

One deployment can run several WhatsApp accounts at once. The main bot uses `session/`, and each clone gets its own folder: `session2/`, `session3/`, etc.

1. From the owner/SUDO account, send:

   ```
   .pair 919876543210
   ```

2. The bot replies with a **pairing code**. On that phone open **WhatsApp → Linked devices → Link with phone number** and enter the code.

3. When the code is accepted, the clone comes online and runs the same plugins as the main bot. It reconnects automatically after restarts using its saved session.

Rules:

- **Maximum 4 sessions per deployment by default** (main + 3 clones). Change it with `MAX_SESSIONS` in `.env`.
- Only the owner and SUDO numbers can pair, unpair or list sessions.
- A clone works **only while its WhatsApp session is live**. If that number logs out from WhatsApp (Linked devices → Log out), the bot detects the logout and **deletes that clone's session folder automatically**, freeing the slot for a new `.pair`.
- `.unpair <number>` removes a clone manually. `.unpair all` removes every clone. The main session is never removed this way.
- `.sessions` shows slot, number and live status.
- Session slots are stored in `galaxy-sessions.json` next to the session folder (for the default setup, in the project root; for `SESSION_DIR=/data/session`, in `/data/galaxy-sessions.json`). Keep it on persistent storage with the sessions.
- Run only one bot process per deployment; two processes using the same session folder cause WhatsApp conflicts (`440`).

## Call play (experimental)

`.callplay <song name>` makes the bot place a WhatsApp voice call to **you** and play the song in the call. It calls only the person who sent the command, one call at a time. Group calls are not supported.

It uses the unofficial [`baileys-caller`](https://github.com/SheIITear/baileys-caller) library, which is not on npm, and it needs its own linked-device session. Unofficial calling can get a number restricted, so use a spare bot number.

```bash
# 1. install the call library (needs git and Node 20 or newer)
npm i github:SheIITear/baileys-caller @whiskeysockets/baileys@npm:baileys@7.0.0-rc14

# 2. link a call session with a pairing code (no QR needed)
node scripts/callpair.js 919876543210
# WhatsApp -> Linked devices -> Link with phone number -> enter the code

# 3. restart the bot, then send from another number:
#    .callplay Varnajaalam
```

By default only the owner and SUDO numbers can use it. Set `CALL_PLAY_PUBLIC=true` to open it to everyone. Keep the `call-session/` folder out of GitHub.

## Plugin interface

Create a `.js` file inside `plugins/`. A plugin exports a unique `name`, optional `aliases`, `description` and `category`, and an async `execute` function.

```js
"use strict";

module.exports = {
  name: "hello",
  aliases: ["hi"],
  description: "Say hello",
  async execute({ sock, jid, message, query }) {
    await sock.sendMessage(
      jid,
      { text: query ? `Hello, ${query}!` : "Hello!" },
      { quoted: message }
    );
  },
};
```

`execute` receives `sock`, `jid`, `message`, `query` (the text after the command), `args`, `command`, `config`, `plugins` and `isPrivileged` (true for the bot, owner and SUDO numbers).

A plugin can also export `async handleMessage({ sock, jid, message, text, config })`. It runs for every message, so it can react without a command (for example the mention reply and `.autovv`). Return `true` only if the message was fully handled.

Files in `plugins/` that do not export a valid plugin are skipped, and the log shows `Skipping invalid plugin`. Keep helper files outside that folder.

## Troubleshooting

| Problem | What to try |
| --- | --- |
| `BOT_NUMBER is missing` | Add `BOT_NUMBER` to `.env`, then restart. |
| Pairing fails (`401`, "Couldn't link device") | Remove old linked devices in WhatsApp, delete `session/`, make sure only one bot process runs (`pm2 ls`), enter the newest code quickly, and try `WA_BROWSER=chrome`. |
| `440 Stream Errored (conflict)` in a loop | The same session is running twice. Stop every other copy of the bot (PM2, Docker, another server). |
| `npm install` prints `Killed` | The host kills heavy processes. Install on a VPS, or let the hosting platform build the project. |
| FFmpeg errors | Install FFmpeg, or set `FFMPEG_PATH`. |
| `.mp4` fails | Install the webp tools (`anim_dump`), or set `ANIM_DUMP_PATH`. |
| View-once media does not arrive | Check that `.autovv status` shows `Browser: android`, then link again if it was linked with another type. |

## Deployment and security notes

- Keep `.env`, `session/`, `session2/`, `session3/`, `galaxy-sessions.json`, `call-session/` and any private credentials out of version control.
- `.env.example` contains placeholders only.
- Run only **one** live bot per WhatsApp session.
- **Railway:** add a persistent Volume mounted at `/data` and set `SESSION_DIR=/data/session`, otherwise the bot and its clones must be linked again after every redeploy. The mount also holds `galaxy-sessions.json`, the registry of paired clones.
- **Docker:** the included `Dockerfile` builds a Node 20 image with FFmpeg. Add `webp` to its `apt-get install` line for `.mp4`, and `git` if you use `.callplay`.
- Files changed on the server over SSH are lost on redeploy. Push your changes to GitHub.

## Community and support

- **WhatsApp Channel:** [Join the official channel](https://whatsapp.com/channel/0029VbEeThTFi8xbIaGLDu3j)
- **WhatsApp Bot Group:** [Join the support group](https://chat.whatsapp.com/KF4H0ogYk8E5aeuLzc7b2a?s=cl&p=a&iam=2)

## License

MIT
