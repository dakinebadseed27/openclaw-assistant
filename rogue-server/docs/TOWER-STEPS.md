# Tower Steps

Do these after `START-HERE.cmd` says DONE and the USB is ejected. Install the tower the same day, because the Tailscale key expires in 1 day.

## Install

1. **Liveness test.** Plug a USB keyboard into the tower and power it on. Wait 30 seconds, then press Caps Lock.
   - Light toggles: the tower is alive. Power it off (hold the power button) and keep going.
   - No light: hardware problem. Stop here.
2. Plug the tower into the Netgear router with an Ethernet cable. Insert the Rogue USB. Power on.
3. Walk away. The tower installs itself and then **turns itself off**. That takes 15 to 40 minutes. Off means done.
4. **Pull the USB out before you power on again.** If the tower boots from the USB a second time, it wipes the disk and reinstalls without asking. Then power on.

Heads up: the installer uses the **largest** drive in the tower. If it has both an SSD and a bigger hard drive, Ubuntu goes on the hard drive. Fine for now, and easy to change later.

## Check it

5. Wait 5 minutes. Open the Tailscale admin console. You should see `rogue-server` in the machine list.
6. On the Portal, open `https://rogue-server.<your-tailnet>.ts.net` and bookmark it. The first load can take up to a minute while it gets its HTTPS certificate.
   - Tap **SERVER ▸** in the header for the server monitor. Bookmark that too (`.../server/`).
7. From the laptop, run: `ssh <username>@rogue-server`
8. In the Tailscale admin console, open `rogue-server` and choose **Disable key expiry**.
9. Erase the USB. It held the Tailscale key. A quick format in Windows is fine.

## If something's off

| What you see | What it means | What to do |
|---|---|---|
| No Caps Lock light | Hardware problem, not the USB | Stop. Check power and RAM. |
| Never turns off, even after an hour | Probably didn't boot from the USB | It needs a screen once to fix the boot order in the BIOS |
| Turned off, but not on Tailscale | First boot didn't finish | Try `ssh <username>@rogue-server.local`, or find its IP in the Netgear device list and SSH to that. Then run `sudo cat /var/log/firstboot.log` |
| Tailscale shows it, but the link won't load | HTTPS or MagicDNS is off | Turn both on in Tailscale admin > DNS, then run `sudo tailscale serve --bg /srv/dashboard` on the tower |
| Server monitor says COLLECTOR DOWN | The status timer stopped | Run `sudo systemctl restart rogue-status.timer` |

First boot retries on its own every time the tower restarts, so restarting it once is a fair first move.

## Later, when a screen is handy

Set the BIOS to **power on after power loss**, so the tower comes back by itself after an outage.
