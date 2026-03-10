# OpenClaw Installer

One-click macOS installer for [OpenClaw](https://github.com/nicepkg/openclaw) — the open-source AI agent.

## What it does

1. **Checks environment** — detects Node.js and npm
2. **Installs OpenClaw** — via npm, with China mirror acceleration
3. **Configures Kimi AI** — sets up Moonshot API key and default model
4. **Launches Dashboard** — starts gateway and opens the control panel

## Download

Download the latest `.dmg` from [Releases](../../releases).

## Build from source

Requirements: Rust, Node.js

```bash
git clone https://github.com/nicepkg/openclaw-installer.git
cd openclaw-installer
cargo tauri dev      # development
cargo tauri build    # production .dmg
```
