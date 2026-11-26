# GALAXY-MD 🚀

A fast, plugin-based **WhatsApp bot** built on **Baileys** with **CommonJS plugin files**. It runs on Android (Termux), hosting panels, VPS / cloud hosting (PM2, Docker, Railway) and PC.

**GitHub:** https://github.com/ansadser/Galaxy-Md

## Features

- **Pairing-code login:** link the bot with a code, no QR scan needed.
- **Session persistence:** the login is saved in `session/` and reused after restarts.
- **Auto-reconnect** after temporary network drops.
- **Clone bots (`.pair`):** link extra WhatsApp numbers to the same running bot. Each one gets its own session folder (`session2`, `session3` ...) and is removed automatically when it logs out. See [Clone bots](#clone-bots-pair).
- **YouTube downloads without third-party APIs:** video (with a quality list), audio and search, fetched directly from YouTube. See [YouTube downloads](#youtube-downloads).
- **More downloaders:** Spotify, Instagram, Facebook, TikTok, Pinterest, X/Twitter and TeraBox, with automatic fallback between several APIs.
- **Media tools:** MP3 converter, animated sticker to MP4, black-screen video, trim / slow / speed / bass, song finder, AI image upscale, file to link.
- **Group tools:** tag members, kick, promote, demote, welcome / goodbye messages, anti-link.
- **Auto view-once:** view-once photos, videos and voice notes are sent to the owner number.
- **Access control:** `.mode public` for everyone, `.mode private` for the bot, owner and SUDO numbers only.
- **Modular plugins:** every command is a separate `.js` file inside `plugins/`.

## Requirements

- **Node.js 20 or newer** (the YouTube engine needs it).
- **FFmpeg** for the audio and video commands and for YouTube video + audio merging.
- **webp tools** (`anim_dump`) for the `.mp4` command only.
- A WhatsApp number to use as the bot.

## Installation

Pick one of the four ways below. They all end with a **pairing code** on the first start.

### A. Termux (Android)

```bash
pkg update -y && pkg upgrade -y
pkg install -y nodejs git ffmpeg libwebp
git clone https://github.com/ansadser/Galaxy-Md.git
cd Galaxy-Md
npm install --omit=dev
cp .env.example .env
nano .env        # set BOT_NUMBER and OWNER_NUMBER
npm start
```

### B. Ubuntu / Debian VPS

```bash
sudo apt update && sudo apt install -y git ffmpeg webp curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
git clone https://github.com/ansadser/Galaxy-Md.git
cd Galaxy-Md
npm install --omit=dev
cp .env.example .env
nano .env        # set BOT_NUMBER and OWNER_NUMBER
npm start
```

Keep it running with PM2:

```bash
npm i -g pm2
pm2 start index.js --name Galaxy-Md
pm2 save
pm2 logs Galaxy-Md
```

### C. Hosting panel (no root, no terminal)

For panels that run a Node.js app from a start command:

1. In the panel choose **Node.js 20 or newer**.
2. Upload **only** `panel/start.js` to the panel root (the folder the panel starts in) and name it `start.js`.
3. Open `start.js` and edit the settings at the top: `BOT_NUMBER`, `OWNER_NUMBER`, and optionally `SUDO`, `MODE`, `MAX_CLONES` and the YouTube limits.
4. Set the startup command to `node start.js` and start the server.
5. On the first start the console prints a **pairing code**. Enter it in WhatsApp → **Linked devices → Link with phone number**.

What `start.js` does on every start:

- downloads a static **FFmpeg** (and ffprobe) into `bin/` if it is missing (no root needed);
- downloads the bot (git, or a tarball if git is missing) and, with `AUTO_UPDATE = true`, takes the latest code from GitHub;
- runs `npm install` when packages are missing or `package.json` changed;
- writes `.env` from your settings and starts the bot.

The WhatsApp login (`session/`, `session2/` ...) and the YouTube login (`yt-auth.json`) live **next to** the bot folder, so updates never delete them.

### D. Docker / Railway

The included `Dockerfile` builds a Node 20 image with **FFmpeg**, **webp** (`anim_dump`) and `tini`.

```bash
docker build -t galaxy-md .
docker run -d --name galaxy-md --restart unless-stopped \
  -v galaxy-data:/data \
  -e BOT_NUMBER=919876543210 \
  -e OWNER_NUMBER=919876543210 \
  galaxy-md
docker logs -f galaxy-md      # the pairing code appears here
```

The image sets `SESSION_DIR=/data/session`. Mount a persistent volume at **`/data`**: it then keeps the main login, the clone logins (`/data/session2` ...) and the YouTube login (`/data/yt-auth.json`). Without a volume, the bot must be linked again after every redeploy.

**Railway:** add a Volume mounted at `/data` and put the variables from the table below in the Variables panel. The Dockerfile deliberately has no `VOLUME` line, because Railway does not allow it.

## Clone bots (`.pair`)

`.pair <number>` links **another WhatsApp number** to the running bot. That number then runs the same plugins in the same process, with its own login in its own folder.

```text
.pair 919876543210        link a number (country code + number, no +)
.pair list                show linked clones            (owner / SUDO)
.pair remove 919876543210 unlink a clone                (owner / SUDO)
```

How it works:

1. Someone sends `.pair <number>`. The bot replies with an 8-character **pairing code**.
2. The owner of that number enters it in WhatsApp → **Linked devices → Link with phone number** within `PAIR_WAIT_SECONDS` (default 3 minutes). If nobody enters it in time, the half-made session is deleted.
3. When the link succeeds, the person who sent `.pair` is told that the number is connected. The login is stored in `session2`, `session3` ... next to the main `session/` folder.
4. **If that number logs out of WhatsApp** (or removes the linked device), its session folder is **deleted automatically** and the slot becomes free again.
5. After a restart, every clone that is still logged in comes back by itself. Unfinished sessions are cleaned up.

Limits and rules:

- At most `MAX_CLONES` numbers at once (default 4, maximum 8, `0` turns `.pair` off).
- `PAIR_OWNER_ONLY=true` lets only the owner / SUDO use `.pair <number>`.
- Anti-abuse: the same number can be tried once every 5 minutes, and one person can start a pairing once a minute (the owner is not limited).
- A clone belongs **only to its own number**. The main owner / SUDO list does not apply to it, and a clone has its own `.mode public` / `.mode private`.
- A clone cannot touch the main bot. These commands are refused on a clone: `.pair`, `.autovv`, `.autodl`, `.reboot`, `.setprefix`, `.setbot`, `.setowner`, `.setsudo`, `.getsudo`, `.delsudo`, `.setimage`, `.setvideo`, `.welcome`, `.goodbye`, `.testwelcome`, `.testgoodbye`, `.antilink`, `.ytlogin`, `.ytlogout`. Group automation (welcome, anti-link) and auto view-once run only for the main bot.
- If the main bot and a clone are in the same group and the mode is public, both answer a command.
- Every clone is one more WhatsApp connection in the same process. On a small panel with little memory, use a lower `MAX_CLONES`.

## YouTube downloads

YouTube commands download **directly from YouTube**. There is no third-party download API in between, so they do not stop working when such a service goes down.

| Command | What it does |
| --- | --- |
| `.ytv <link>` | Shows the available qualities with sizes (and an audio-only option). Reply with a number to download. |
| `.video <link> [720p]` | Downloads the video straight away (360p if no quality is given). Shorts links work too. |
| `.yta <link or name>` `.audio` | Best-quality audio as MP3, with title, artist and cover art. |
| `.play <name or link>` `.song` | Searches YouTube and sends the song as an audio file. |
| `.yts <name>` `.ytsearch` | Searches YouTube. Reply with a number for the details, then choose audio or video. |
| `.ytlogin` `.ytlogin status` `.ytlogin force` `.ytlogout` | Owner only. Sign in to YouTube with a spare Google account (see below). |

Good to know:

- **Limits** (set them in `.env`): `MAX_YT_DURATION` (default 60 minutes), `MAX_YT_SIZE` (default 500 MB) and `YT_CONCURRENCY` (default 2 downloads at the same time; the rest wait in a queue). Live streams are refused.
- Videos larger than about 180 MB, or not in a WhatsApp-friendly codec, are sent as a **document**.
- Temporary files go to `TEMP_DIR/galaxy-yt` (default: the system temp folder) and are removed after each download. Leftovers older than one hour are cleaned automatically.
- **`YouTube is blocking this server's IP (HTTP 403)`:** some hosting IPs are flagged by YouTube. This is often temporary. Signing in does not fix an IP block; another host or a VPS does.
- **`.ytlogin`:** if YouTube asks the server to prove it is not a bot, run `.ytlogin`, open the link the bot sends, enter the code with a **spare** Google account, and allow access. The login is saved in `yt-auth.json`. Keep that file private.
- While signed in, the engine reads its client profile list from a public GitHub gist. Set `YT_PROFILES_URL=` (empty) to turn that off and use the built-in profile only.
- If downloads suddenly fail for every video after months of working, YouTube changed something. Update the YouTube packages: `npm update youtubei.js googlevideo bgutils-js`.

## Environment variables

Put these in `.env` (or in the Variables panel of your host). Never commit the `.env` file. On a hosting panel, `start.js` writes the `.env` for you.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `BOT_NUMBER` | Yes | none | WhatsApp number of the bot, with country code and no `+` (example `919876543210`). |
| `OWNER_NUMBER` | No | `BOT_NUMBER` | Owner number. Used for owner-only commands and as the target of auto view-once. |
| `SUDO` | No | none | Comma-separated extra admins who can use commands in private mode. |
| `MODE` | No | `public` | `public` for everyone, `private` for owner and SUDO only. Change it later with `.mode`. |
| `BOT_NAME` | No | `GALAXY-MD` | Name shown by the bot. |
| `PREFIX` | No | `.` | Command prefix. Change it later with `.setprefix`. |
| `SESSION_DIR` | No | `./session` | Folder for the main WhatsApp login. Clone sessions and `yt-auth.json` are stored next to it. In Docker use `/data/session` on a persistent volume. |
| `WA_BROWSER` | No | `safari` | Linked-device type: `safari`, `chrome` or `android`. **`android` is needed for view-once media** (`.autovv`). Use `chrome` if linking fails. |
| `MAX_CLONES` | No | `4` | How many extra numbers `.pair` can link at once. `0` turns it off, maximum `8`. |
| `PAIR_OWNER_ONLY` | No | `false` | `true` lets only the owner / SUDO use `.pair <number>`. |
| `PAIR_WAIT_SECONDS` | No | `180` | How long a pairing code stays valid before the half-made session is deleted. |
| `MAX_YT_DURATION` | No | `60` | Longest YouTube video, in minutes. |
| `MAX_YT_SIZE` | No | `500` | Biggest YouTube download, in MB. |
| `YT_CONCURRENCY` | No | `2` | YouTube downloads running at the same time. |
| `TEMP_DIR` | No | system temp folder | Folder for temporary YouTube files. Useful when `/tmp` is small. |
| `YT_COOKIE` | No | none | Optional YouTube cookie string for anonymous requests. |
| `YT_AUTH_FILE` | No | next to `SESSION_DIR` | Where `.ytlogin` saves the YouTube login. |
| `YT_PROFILES_URL` | No | built-in gist | Source of YouTube client profiles used while signed in. Empty turns it off. |
| `YT_DEBUG` | No | none | Any value prints extra YouTube parser warnings. |
| `FFMPEG_PATH` | No | `ffmpeg` | Full path of FFmpeg if it is not on `PATH`. |
| `ANIM_DUMP_PATH` | No | `anim_dump` | Full path of `anim_dump` (webp tools), used by `.mp4`. |
| `MUSIC_FINDER_URL` | No | built-in service | Song recognition API used by `.find`. |
| `UPLOAD_MAX_MB` | No | `200` | Biggest file `.upload` will fetch, in MB. |

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
| `.pair <number>` `.clone` | Link another number as a clone bot (see [Clone bots](#clone-bots-pair)) |

### Downloaders

| Command | What it does |
| --- | --- |
| `.video <link> [720p]` | YouTube video as MP4 |
| `.ytv <link>` | YouTube video, choose the quality by number |
| `.yta` `.audio <link or name>` | YouTube audio as MP3 |
| `.play` `.song <name>` | Search YouTube and send the song |
| `.yts` `.ytsearch <name>` | Search YouTube and pick audio or video |
| `.spotify` `.spotifyplay <name>` | Spotify track as MP3 |
| `.insta <link>` | Instagram reels and videos |
| `.fb` `.facebook <link>` | Facebook videos |
| `.tiktok` `.tt <link>` | TikTok videos without watermark |
| `.pinterest` `.pin <link>` | Pinterest images and videos |
| `.twitter` `.x` `.tweet` `.twitdl <link>` | X/Twitter videos and images |
| `.tera <link>` | TeraBox files |
| `.upload <url>` | Download a file from a URL and send it to the chat |
| `.autodl on/off` | Auto download Instagram, Facebook, TeraBox and Spotify links (owner) |

YouTube links are never downloaded automatically. Use the YouTube commands above.

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
| `.ttx` | **Reply** to a `.txt` file to send its full text in the chat |

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
| `.ytlogin` `.ytlogout` | Sign in to / out of YouTube (owner / SUDO) |
| `.pair list` `.pair remove <number>` | List or unlink clone bots (owner / SUDO) |
| `.reboot` | Restart the bot process (owner / SUDO) |
| `.send number\|message` | Send a message to a number (owner / SUDO) |
| `.forward number` | **Reply** to a message to forward it to a number |
| `.fd <jid>` | **Reply** to an audio to send it as a voice note to a JID or channel |
| `.save` | **Reply** to a message to get it in your private chat |

The bot also answers with a random voice note when the bot or the owner is mentioned in a group.

## Auto view-once

Every view-once photo, video or voice note that reaches the bot is sent to the owner number, and the sender is mentioned in the caption. Use `.autovv off` to stop it and `.autovv status` to see the state. It runs only for the main bot, never for a clone.

WhatsApp sends view-once media only to Android-type linked devices, so set `WA_BROWSER=android` in `.env` before linking. The default is `safari`. If the bot was linked with another type, delete the `session/` folder and link again.

## Plugin interface

Create a `.js` file inside `plugins/`. A plugin exports a unique `name`, optional `aliases`, `description` and `category`, and an async `execute` function.

```js
"use strict";

module.exports = {
  name: "hello",
  aliases: ["hi"],
  description: "Say hello",
  category: "Utility",
  async execute({ sock, jid, message, query }) {
    await sock.sendMessage(
      jid,
      { text: query ? `Hello, ${query}!` : "Hello!" },
      { quoted: message }
    );
  },
};
```

`execute` receives `sock`, `jid`, `message`, `query` (the text after the command), `args`, `command`, `config`, `plugins`, `manager` (the clone manager used by `.pair`) and `isPrivileged` (true for the bot, owner and SUDO numbers; on a clone, only for the clone's own number).

A plugin can also export `async handleReply({ sock, jid, message, text, config, plugins })` for numbered replies, and `async handleMessage({ sock, jid, message, text, config })`, which runs for every message so it can react without a command (for example the mention reply). Return `true` only if the message was fully handled.

**Writing plugins that also run on clones:** use the `config` you receive, not `require("../config")`, because a clone has its own `config.botNumber`, `config.ownerNumber` and `config.mode` (`config.isClone` is `true`). A command that changes bot-wide state (files such as `galaxy-data.json`, owner, SUDO, prefix) must be added to `CLONE_BLOCKED_COMMANDS` in `index.js`.

Files in `plugins/` that do not export a valid plugin are skipped, and the log shows `Skipping invalid plugin`. Put shared helper code in `lib/`.

## Troubleshooting

| Problem | What to try |
| --- | --- |
| `BOT_NUMBER is missing` | Add `BOT_NUMBER` to `.env`, then restart. |
| Pairing fails (`401`, "Couldn't link device") | Remove old linked devices in WhatsApp, delete `session/`, make sure only one bot process runs (`pm2 ls`), enter the newest code quickly, and try `WA_BROWSER=chrome`. |
| `440 Stream Errored (conflict)` in a loop | The same session is running twice. Stop every other copy of the bot (PM2, Docker, another server, a panel). |
| Logged out of WhatsApp | The main bot does not reconnect after a logout. Delete the `session/` folder and restart to get a new pairing code. |
| `npm install` prints `Killed` | The host kills heavy processes. Install on a VPS, or let the hosting platform build the project. |
| `YouTube downloader packages are missing` | Run `npm install` in the bot folder and restart. On a panel, restart with `node start.js`. |
| `YouTube is blocking this server's IP` | See [YouTube downloads](#youtube-downloads): try later, or use another host. |
| YouTube asks to sign in | Run `.ytlogin` as the owner. |
| `.pair` says all slots are in use | Use `.pair list`, then `.pair remove <number>`, or raise `MAX_CLONES`. |
| A clone was removed by itself | It logged out of WhatsApp, or its code was not entered within `PAIR_WAIT_SECONDS`. Send `.pair <number>` again. |
| FFmpeg errors | Install FFmpeg, or set `FFMPEG_PATH`. On a panel, `start.js` downloads it for you. |
| `.mp4` fails | Install the webp tools (`anim_dump`), or set `ANIM_DUMP_PATH`. The Docker image already has it. |
| View-once media does not arrive | Set `WA_BROWSER=android`, delete `session/` and link again. Check with `.autovv status`. |

## Deployment and security notes

- Keep `.env`, `session/`, `session2/` ..., `data/` and `yt-auth.json` out of version control. The included `.gitignore` and `.dockerignore` already do this.
- `.env.example` contains placeholders only.
- Run only **one** live bot per WhatsApp session.
- Anyone who can use `.pair` can link a number to your server while a slot is free. Set `PAIR_OWNER_ONLY=true` if you do not want that, or `MAX_CLONES=0` to turn it off.
- Files changed on the server over SSH or in a panel file manager are lost when the bot is updated or redeployed. Push your changes to GitHub.

## Community and support

- **WhatsApp Channel:** [Join the official channel](https://whatsapp.com/channel/0029VbEeThTFi8xbIaGLDu3j)
- **WhatsApp Bot Group:** [Join the support group](https://chat.whatsapp.com/KF4H0ogYk8E5aeuLzc7b2a?s=cl&p=a&iam=2)

## License

MIT
