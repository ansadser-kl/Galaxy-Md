# GALAXY-MD 🚀

A lightweight, modular WhatsApp bot built with **Baileys (`7.0.0-rc14`)** and **CommonJS plugin files**, designed for Android Termux, VPS/cloud hosting, and PC/laptop.

## Features

- **Pairing-Code Login:** Fast pairing-code authentication without needing a QR code scan.
- **Session Persistence:** Reads `BOT_NUMBER` from `.env` and saves auth data in `session/` to reuse across restarts.
- **Auto-Reconnect:** Automatically reconnects after temporary network disconnects.
- **Modular Plugins:** Commands are dynamically loaded from individual `.js` files inside `plugins/`.
- **Access Control:** Use `.mode public` to allow everyone to run commands, or `.mode private` to restrict commands to `BOT_NUMBER`, `OWNER_NUMBER`, and `SUDO` numbers.

## Installation & Configuration

1. **Clone the repository:**

```bash
git clone [https://github.com/ansadser-kl/Galaxy-Md.git](https://github.com/ansadser-kl/Galaxy-Md.git)
cd Galaxy-Md
```

2. **Install dependencies and create your environment file:**

```bash
npm install
cp .env.example .env
```

3. **Configure `.env` with your WhatsApp details:**

```env
BOT_NUMBER="919876543210"
OWNER_NUMBER="919876543210"
SUDO="919111111111,919222222222"
MODE="public"
```

4. **Start the bot:**

```bash
npm start
```

> **Note:** A pairing code is requested only if the saved session is not registered. Once linked, keep the `session/` folder intact.

## Plugin Interface

Create a `.js` file inside the `plugins/` directory. Each plugin should export an object containing a unique `name`, optional `aliases`, optional `description`, and an async `execute` function.

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

## Deployment & Security Notes

- Keep `.env`, `session/`, and private credentials out of version control.
- Run only one live bot instance per WhatsApp session at a time to avoid connection conflicts.
- For 24/7 uptime on a VPS or container, run the bot using PM2 (`pm2 start index.js --name "Galaxy-Md"`).

## Community & Support

- **WhatsApp Channel:** [Join Official Channel](https://whatsapp.com/channel/0029VbEeThTFi8xbIaGLDu3j)
- **WhatsApp Bot Group:** [Join Support Group](https://chat.whatsapp.com/KF4H0ogYk8E5aeuLzc7b2a?s=cl&p=a&iam=2)
