#!/usr/bin/env python3
"""Rogue Server status collector.

Runs every 30s from rogue-status.timer and writes /srv/dashboard/server/status.json
for the server monitor page. Read-only: it looks at the system, it never changes it.
Uses only the Python standard library and tools that ship with Ubuntu Server.
"""
import json
import os
import platform
import shutil
import socket
import subprocess
import time
from datetime import datetime, timezone

OUT = "/srv/dashboard/server/status.json"
STATE = "/var/lib/rogue-status/state.json"
HISTORY_LEN = 120          # 120 samples x 30s = 1 hour
UPDATES_EVERY = 1800       # re-count apt updates every 30 min
SERVICES = [
    ("ssh", "SSH"),
    ("tailscaled", "Tailscale"),
    ("avahi-daemon", "Local name (.local)"),
    ("unattended-upgrades", "Auto updates"),
    ("rogue-status.timer", "Status collector"),
]


def run(cmd, timeout=10):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout, r.stderr
    except Exception:
        return 1, "", ""


def read(path, default=""):
    try:
        with open(path) as f:
            return f.read()
    except Exception:
        return default


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat(timespec="seconds")


def cpu_times():
    parts = read("/proc/stat").splitlines()[0].split()[1:]
    vals = [int(x) for x in parts]
    idle = vals[3] + (vals[4] if len(vals) > 4 else 0)
    return sum(vals), idle


def cpu_usage():
    t1, i1 = cpu_times()
    time.sleep(1)
    t2, i2 = cpu_times()
    dt = t2 - t1
    return round(100.0 * (1 - (i2 - i1) / dt), 1) if dt else 0.0


def cpu_model():
    for line in read("/proc/cpuinfo").splitlines():
        if line.startswith("model name"):
            return line.split(":", 1)[1].strip()
    return platform.processor() or "unknown"


def cpu_temp():
    # Prefer the CPU package sensor (Intel coretemp / AMD k10temp), else any thermal zone.
    base = "/sys/class/hwmon"
    if os.path.isdir(base):
        for h in sorted(os.listdir(base)):
            name = read(f"{base}/{h}/name").strip()
            if name in ("coretemp", "k10temp", "zenpower"):
                t = read(f"{base}/{h}/temp1_input").strip()
                if t.isdigit():
                    return round(int(t) / 1000, 1)
    best = None
    tz = "/sys/class/thermal"
    if os.path.isdir(tz):
        for z in sorted(os.listdir(tz)):
            if not z.startswith("thermal_zone"):
                continue
            t = read(f"{tz}/{z}/temp").strip()
            if t.lstrip("-").isdigit():
                v = int(t) / 1000
                if read(f"{tz}/{z}/type").strip() == "x86_pkg_temp":
                    return round(v, 1)
                best = v if best is None else max(best, v)
    return round(best, 1) if best is not None else None


def meminfo():
    m = {}
    for line in read("/proc/meminfo").splitlines():
        k, v = line.split(":", 1)
        m[k] = int(v.split()[0]) * 1024
    total = m.get("MemTotal", 0)
    used = total - m.get("MemAvailable", 0)
    stotal = m.get("SwapTotal", 0)
    sused = stotal - m.get("SwapFree", 0)
    pct = lambda u, t: round(100.0 * u / t, 1) if t else 0.0
    return (
        {"total_bytes": total, "used_bytes": used, "pct": pct(used, total)},
        {"total_bytes": stotal, "used_bytes": sused, "pct": pct(sused, stotal)},
    )


def disks():
    out = []
    for mount in ("/", "/boot", "/srv"):
        if not os.path.ismount(mount) and mount != "/":
            continue
        try:
            u = shutil.disk_usage(mount)
        except Exception:
            continue
        out.append({
            "mount": mount,
            "total_bytes": u.total,
            "used_bytes": u.used,
            "pct": round(100.0 * u.used / u.total, 1) if u.total else 0.0,
        })
    return out


def lan():
    iface, ip = None, None
    code, out, _ = run(["ip", "-4", "-o", "route", "get", "1.1.1.1"])
    if code == 0:
        f = out.split()
        if "dev" in f:
            iface = f[f.index("dev") + 1]
        if "src" in f:
            ip = f[f.index("src") + 1]
    return iface, ip


def net_bytes(iface):
    if not iface:
        return 0, 0
    rx = read(f"/sys/class/net/{iface}/statistics/rx_bytes").strip()
    tx = read(f"/sys/class/net/{iface}/statistics/tx_bytes").strip()
    return int(rx or 0), int(tx or 0)


def tailscale():
    if not shutil.which("tailscale"):
        return {"installed": False, "online": False, "ip": None, "dns_name": None, "serving": False}
    code, out, _ = run(["tailscale", "status", "--json"])
    info = {"installed": True, "online": False, "ip": None, "dns_name": None, "serving": False}
    if code == 0:
        try:
            s = json.loads(out)
            info["online"] = s.get("BackendState") == "Running"
            self_ = s.get("Self") or {}
            ips = [i for i in (self_.get("TailscaleIPs") or []) if "." in i]
            info["ip"] = ips[0] if ips else None
            info["dns_name"] = (self_.get("DNSName") or "").rstrip(".") or None
        except Exception:
            pass
    code, out, _ = run(["tailscale", "serve", "status"])
    info["serving"] = code == 0 and "/srv/dashboard" in out
    return info


def services():
    res = []
    for unit, label in SERVICES:
        _, out, _ = run(["systemctl", "is-active", unit], timeout=5)
        res.append({"name": unit, "label": label, "state": out.strip() or "unknown"})
    return res


def firstboot():
    _, enabled, _ = run(["systemctl", "is-enabled", "rogue-firstboot.service"], timeout=5)
    log = read("/var/log/firstboot.log")
    lines = [l for l in log.splitlines() if l.strip()][-8:]
    if "first boot complete" in log and enabled.strip() != "enabled":
        state = "done"
    elif "FAILED" in (lines[-1] if lines else ""):
        state = "failed"
    else:
        state = "pending"
    return {"state": state, "log_tail": lines}


def count_updates():
    checker = "/usr/lib/update-notifier/apt-check"
    if os.path.exists(checker):
        _, _, err = run([checker], timeout=120)
        try:
            pending, security = (int(x) for x in err.strip().split(";")[:2])
            return pending, security
        except Exception:
            pass
    code, out, _ = run(["apt", "list", "--upgradable"], timeout=120)
    if code == 0:
        lines = [l for l in out.splitlines() if "/" in l]
        return len(lines), sum(1 for l in lines if "-security" in l)
    return None, None


def top_processes():
    _, out, _ = run(["ps", "-eo", "comm,pcpu,pmem", "--sort=-pcpu", "--no-headers"])
    procs = []
    for line in out.splitlines()[:6]:
        f = line.rsplit(None, 2)
        if len(f) == 3 and f[0] not in ("ps", "rogue-status.py"):
            procs.append({"name": f[0], "cpu_pct": float(f[1]), "mem_pct": float(f[2])})
    return procs[:5]


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=1)
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)


def main():
    now = time.time()
    try:
        state = json.loads(read(STATE, "{}"))
    except Exception:
        state = {}

    cpu_pct = cpu_usage()
    mem, swap = meminfo()
    iface, lan_ip = lan()
    rx, tx = net_bytes(iface)
    prev = state.get("net") or {}
    rx_rate = tx_rate = 0
    if prev.get("iface") == iface and now > prev.get("t", now):
        dt = now - prev["t"]
        rx_rate = max(0, int((rx - prev["rx"]) / dt))
        tx_rate = max(0, int((tx - prev["tx"]) / dt))
    state["net"] = {"iface": iface, "rx": rx, "tx": tx, "t": now}

    if now - state.get("updates_t", 0) > UPDATES_EVERY:
        state["updates"] = count_updates()
        state["updates_t"] = now
    pending, security = state.get("updates") or (None, None)

    hist = state.get("history") or {"cpu_pct": [], "mem_pct": []}
    hist["cpu_pct"] = (hist.get("cpu_pct", []) + [cpu_pct])[-HISTORY_LEN:]
    hist["mem_pct"] = (hist.get("mem_pct", []) + [mem["pct"]])[-HISTORY_LEN:]
    state["history"] = hist

    uptime = float(read("/proc/uptime", "0").split()[0])
    os_name = "Linux"
    for line in read("/etc/os-release").splitlines():
        if line.startswith("PRETTY_NAME="):
            os_name = line.split("=", 1)[1].strip('"')

    status = {
        "schema": 1,
        "sample": False,
        "generated": iso(now),
        "interval_seconds": 30,
        "hostname": socket.gethostname(),
        "os": os_name,
        "kernel": platform.release(),
        "uptime_seconds": int(uptime),
        "boot_time": iso(now - uptime),
        "load": [round(x, 2) for x in os.getloadavg()],
        "cpu": {"model": cpu_model(), "cores": os.cpu_count(), "usage_pct": cpu_pct, "temp_c": cpu_temp()},
        "memory": mem,
        "swap": swap,
        "disks": disks(),
        "network": {"interface": iface, "lan_ip": lan_ip, "rx_bytes_per_s": rx_rate, "tx_bytes_per_s": tx_rate},
        "tailscale": tailscale(),
        "services": services(),
        "updates": {
            "pending": pending,
            "security": security,
            "reboot_required": os.path.exists("/var/run/reboot-required"),
            "checked": iso(state["updates_t"]) if state.get("updates_t") else None,
        },
        "firstboot": firstboot(),
        "top_processes": top_processes(),
        "history": {"interval_seconds": 30, **hist},
    }
    write_json(OUT, status)
    write_json(STATE, state)


if __name__ == "__main__":
    main()
