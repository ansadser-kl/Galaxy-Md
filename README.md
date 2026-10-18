# GALAXY-MD 🚀

A starter WhatsApp bot using **Baileys 7.0.0-rc14** and **CommonJS .js files**. Designed for Android Termux, VPS/cloud hosting, and PC/laptop.

## Features in v1.0.0

- QR-code login
- Optional pairing-code login
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
npm start
```

Scan the QR code in WhatsApp → **Linked devices** → **Link a device**.

## Pairing-code login (optional)
Set `PAIRING_NUMBER` to your number with country code, digits only.

Linux / VPS:
```bash
PAIRING_NUMBER=919876543210 npm start
```

Termux:
```bash
export PAIRING_NUMBER=919876543210
npm start
```

Enter the code in WhatsApp → **Linked devices** → **Link with phone number**. Never share your pairing code or `session/` folder.

## Commands
- `.ping` — Reply with PONG
- `.alive` — Show bot status
- `.menu` — Show command menu
- `.echo hello` — Repeat text

## Important
- Keep `session/` private; never upload or share it.
- Run only one live bot instance using the same session at a time.
- API downloader and plugin commands can be added next.
