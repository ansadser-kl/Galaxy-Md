# GALAXY-MD 🚀

A WhatsApp bot using **Baileys 7.0.0-rc14** and **CommonJS .js files**, for Android Termux, VPS/cloud hosting, and PC/laptop.

## Features

- **Pairing-code login only** — no QR code flow
- Read phone number from `.env` using `BOT_NUMBER`
- Automatic reconnect after temporary disconnects
- Commands: `.ping`, `.alive`, `.menu`, `.echo`
- Local session storage in `session/` (excluded from Git)

## Requirements

- Node.js 20 or newer recommended
- npm
- A WhatsApp account to link

## Install and start

```bash
git clone https://github.com/ansadser-kl/Galaxy-Md.git
cd Galaxy-Md
npm install
cp .env.example .env
```

Open `.env` and set your WhatsApp number with country code, digits only:

```env
BOT_NUMBER="919876543210"
```

Replace the example with your own number. Do not include a plus sign or spaces. Then run:

```bash
npm start
```

The pairing code will appear in the terminal. On your phone, open WhatsApp → **Linked devices** → **Link with phone number**, then enter the code.

## Commands

- `.ping` — Reply with PONG
- `.alive` — Show bot status
- `.menu` — Show command menu
- `.echo hello` — Repeat text

## Important

- The real `.env` file and `session/` folder must remain private; never upload or share them.
- `.env.example` is only a template.
- Run only one live bot instance using the same session at a time.
- API downloader and plugin commands can be added next.
