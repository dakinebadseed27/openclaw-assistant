# Rogue Server

One USB stick that turns the Lenovo tower into a headless, always-on server with two private dashboards on Tailscale:

- **Main dashboard** at `https://rogue-server.<tailnet>.ts.net/` (directives, calendar, vitals, Hive Mind, tokens)
- **Server monitor** at `https://rogue-server.<tailnet>.ts.net/server/` (CPU, memory, disk, temperature, services, updates, Tailscale, first-boot log)

Both show sample data until real jobs write to them. The server monitor goes live on its own as soon as the tower boots.

## At home

1. Put this `rogue-server` folder at `C:\Users\kamaa\rogue-server\`.
2. Have ready: a USB stick (8 GB or more, it gets erased), Rufus, and Git for Windows (for OpenSSL).
3. Double-click **`START-HERE.cmd`**. It walks you through everything, including when to run Rufus.
4. Then follow **`docs\TOWER-STEPS.md`**.

## What's in here

| Path | What it is |
|---|---|
| `START-HERE.cmd`, `Prepare-RogueUSB.ps1` | The USB builder you run on the laptop |
| `installer\autoinstall.template.yaml` | Ubuntu Server 26.04.1 autoinstall. The builder fills in your username, password hash, and SSH key |
| `payload\firstboot\` | First boot: joins Tailscale, serves the dashboards, shreds the key, switches itself off |
| `payload\status\` | Collector that writes the server monitor's `status.json` every 30 seconds |
| `dashboard\` | Main dashboard (static files, works offline). Data format is in `dashboard\DATA-CONTRACT.md` |
| `dashboard\server\` | Server monitor page |
| `docs\TOWER-STEPS.md` | What to do with the tower |
| `docs\screenshots\` | What the dashboards look like |

## Safety

- Nothing here formats a disk. Rufus does that, and you click Start.
- The builder shows you the USB and waits for you to type `yes` before copying.
- Your password is only ever stored as a SHA-512 hash. The Tailscale key goes straight to the USB, never into this folder, and the tower shreds it after use.
- Both dashboards are reachable only over Tailscale.
