# -*- coding: utf-8 -*-
"""
Steadfast Watch — Windows companion.

The same "agreed watch" as the Android app, for Windows: a local DNS proxy
that reports which domains the machine resolves, gated by the member's consent
on the server, plus the same block list.

Use (in an admin terminal, from this folder):
  python guard.py link                 register the deep-link scheme + open the
                                       web login that hands back the session
  python guard.py on                   set all active adapters' DNS to 127.0.0.1
                                       and run the proxy (Ctrl+C to stop)
  python guard.py off                  restore adapters to DHCP (do this before
                                       closing, or the machine loses DNS)
  python guard.py status               show link state + last proxy results
  python guard.py --port 5353          run the proxy on another port (no netsh)

Honest limits, same as Android v1:
  * Apps using their own DoH/DoT resolver (Chrome/Edge "Secure DNS", Windows
    per-adapter "DNS over HTTPS") bypass this proxy.
  * Only IPv4 is captured; IPv6 queries and the hosts file are not.

The protocol is identical to the Android companion: events are {"domain": ...,
"blocked": bool} batch-POSTed to /api/watch with the member's own session token.
Without an active consent the server refuses, and this tool then stops sending.
"""

from __future__ import print_function

import ctypes
import json
import os
import socket
import socketserver
import struct
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import urllib.parse
import winreg

BASE_URL = "https://steadfast-lake-eta.vercel.app"
SCHEME = "steadfast-watch"
ADDR = "127.0.0.1"
PORT = 53
RESOLVERS = ("1.1.1.2", "1.0.0.2")

CONFIG_DIR = os.path.join(
    os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "steadfast-watch"
)
CONFIG_PATH = os.path.join(CONFIG_DIR, "config.json")

BLOCKED = frozenset(
    [
        "pornhub.com",
        "xvideos.com",
        "xhamster.com",
        "xnxx.com",
        "redtube.com",
        "youporn.com",
        "tube8.com",
        "brazzers.com",
    ]
)


# --------------------------------------------------------------------------
# state
# --------------------------------------------------------------------------
def load_config():
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


def save_config(cfg):
    try:
        os.makedirs(CONFIG_DIR, exist_ok=True)
        with open(CONFIG_PATH, "w", encoding="utf-8") as fh:
            json.dump(cfg, fh)
    except Exception as exc:
        print("[config] could not save:", exc)


def is_blocked(domain):
    d = domain.rstrip(".")
    if d in BLOCKED:
        return True
    return any(d.endswith("." + b) for b in BLOCKED)


# --------------------------------------------------------------------------
# DNS bits (pure stdlib)
# --------------------------------------------------------------------------
def parse_question(pkt):
    """Return (domain, offset_after_qname) or None if not a usable query."""
    if len(pkt) < 12:
        return None
    flags = struct.unpack(">H", pkt[2:4])[0]
    if flags & 0x8000:  # a response, not a query
        return None
    qd = struct.unpack(">H", pkt[4:6])[0]
    if qd < 1:
        return None
    i = 12
    parts = []
    while True:
        if i >= len(pkt):
            return None
        length = pkt[i]
        if length == 0:
            i += 1
            break
        if length > 63 or i + 1 + length > len(pkt):
            return None
        parts.append(pkt[i + 1: i + 1 + length].decode("ascii", "replace"))
        i += length + 1
    if not parts:
        return None
    return ".".join(parts), i


def build_nxdomain(pkt):
    """Answer NXDOMAIN from the original query so blocked domains vanish."""
    out = bytearray(pkt)
    flags = struct.unpack(">H", bytes(out[2:4]))[0]
    base = 0x8083  # QR=1, RA=1, rcode=3 (NXDOMAIN)
    if flags & 0x0100:  # keep the client's RD bit
        base |= 0x0100
    struct.pack_into(">H", out, 2, base)
    struct.pack_into(">HHH", out, 6, 0, 0, 0)  # an/ns/ar counts = 0
    return bytes(out)


# --------------------------------------------------------------------------
# reporter — batched POST, same contract as /api/watch, token from config
# --------------------------------------------------------------------------
class Reporter(threading.Thread):
    def __init__(self):
        super(Reporter, self).__init__(daemon=True)
        self.events = []
        self.lock = threading.Lock()
        self.last = None  # "ok" | "refused" | "retry" | "no-token"
        self._stop = threading.Event()

    def stop(self):
        self._stop.set()
        self.flush()

    def event(self, domain, blocked):
        with self.lock:
            keep = self.events[-499:]
            keep.append({"domain": domain, "blocked": blocked})
            self.events = keep

    def run(self):
        while not self._stop.wait(15):
            self.flush()

    def flush(self):
        token = load_config().get("token")
        with self.lock:
            if not self.events:
                return
            batch = self.events
            self.events = []
        if not token:
            self.last = "no-token"
            print("[report] not linked — nothing sent (link first)")
            return
        body = json.dumps({"events": batch}).encode("utf-8")
        req = urllib.request.Request(
            BASE_URL + "/api/watch",
            data=body,
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token,
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=8) as resp:
                self.last = "ok" if resp.status in (200, 201, 202) else "refused"
                print("[report] sent {} events -> {}".format(len(batch), resp.status))
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403):
                self.last = "refused"
                print("[report] refused HTTP {} (consent off or session gone) — relink".format(exc.code))
                cfg = load_config()
                cfg.pop("token", None)
                save_config(cfg)
            else:
                self.last = "retry"
                print("[report] HTTP {} -> will retry".format(exc.code))
                with self.lock:
                    self.events = batch + self.events
        except Exception as exc:
            self.last = "retry"
            print("[report] retry:", exc)
            with self.lock:
                self.events = batch + self.events


reporter = Reporter()


# --------------------------------------------------------------------------
# proxy
# --------------------------------------------------------------------------
class DnsHandler(socketserver.BaseRequestHandler):
    def handle(self):
        data, sock = self.request
        if len(data) < 12:
            return
        parsed = parse_question(data)
        if parsed is None:
            return
        domain, qend = parsed
        self.server.last_domain = domain
        if is_blocked(domain):
            self.server.last_action = "blocked"
            reporter.event(domain, True)
            sock.sendto(build_nxdomain(data), self.client_address)
            print("[dns] BLOCKED", domain)
            return
        self.server.last_action = "allowed"
        reporter.event(domain, False)
        for resolver in RESOLVERS:
            sock2 = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            try:
                sock2.settimeout(2)
                sock2.sendto(data, (resolver, 53))
                reply, _ = sock2.recvfrom(2048)
                sock.sendto(reply, self.client_address)
                print("[dns] {} -> {} (allowed)".format(domain, resolver))
                return
            except Exception:
                continue
            finally:
                sock2.close()
        print("[dns] all resolvers failed for", domain)


class DnsServer(socketserver.ThreadingUDPServer):
    last_domain = None
    last_action = None
    allow_reuse_address = True


# --------------------------------------------------------------------------
# adapter DNS management (needs admin) + deep-link scheme registration
# --------------------------------------------------------------------------
def is_admin():
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def interface_names():
    try:
        out = subprocess.check_output(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                "Get-NetIPInterface -AddressFamily IPv4 -ErrorAction SilentlyContinue "
                "| Where-Object ConnectionState -eq 'Connected' "
                "| Select-Object -ExpandProperty InterfaceAlias",
            ],
            text=True,
        )
        return [
            line.strip()
            for line in out.splitlines()
            if line.strip() and not line.strip().startswith("PS")
        ]
    except Exception:
        return []


def set_proxy_dns():
    changed = []
    for name in interface_names():
        result = subprocess.run(
            [
                "netsh",
                "interface",
                "ipv4",
                "set",
                "dnsservers",
                "name=" + name,
                "static",
                "127.0.0.1",
                "primary",
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            changed.append(name)
            print("[dns-settings] {} -> 127.0.0.1".format(name))
        else:
            print("[dns-settings] could not set", name)
    return changed


def restore_dns(adapters):
    for name in adapters:
        subprocess.run(
            [
                "netsh",
                "interface",
                "ipv4",
                "set",
                "dnsservers",
                "name=" + name,
                "source=dhcp",
            ],
            capture_output=True,
        )
        print("[dns-settings] {} -> dhcp".format(name))


def register_scheme():
    launcher = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
    if not os.path.exists(launcher):
        launcher = sys.executable
    scheme_key = r"SOFTWARE\Classes\{}".format(SCHEME)
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, scheme_key) as key:
        winreg.SetValueEx(key, "", 0, winreg.REG_SZ, "URL:Steadfast Watch")
        winreg.SetValueEx(key, "URL Protocol", 0, winreg.REG_SZ, "")
    command_key = scheme_key + r"\shell\open\command"
    command = '"{}" "{}" --scheme "%1"'.format(launcher, os.path.abspath(__file__))
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, command_key) as key:
        winreg.SetValue(key, "", winreg.REG_SZ, command)
    print("[scheme] registered {}".format(SCHEME))


def handle_scheme(url):
    query = urllib.parse.urlparse(url).query
    params = urllib.parse.parse_qs(query)
    token = params.get("token")
    if not token:
        print("[link] no token in:", url)
        return 1
    cfg = load_config()
    cfg["token"] = token[0]
    cfg["refresh"] = params.get("refresh", [""])[0]
    cfg["exp"] = params.get("exp", [""])[0]
    save_config(cfg)
    print("[link] linked: token saved")
    return 0


# --------------------------------------------------------------------------
# console entry points
# --------------------------------------------------------------------------
def cmd_link():
    register_scheme()
    os.startfile(BASE_URL + "/watch/link")
    print("[link] opened the login. Sign in; the app hands the token back.")


def cmd_on():
    if not is_admin():
        print("admin required: right-click the terminal -> Run as administrator")
        return 2
    register_scheme()
    adapters = set_proxy_dns()
    cfg = load_config()
    cfg["adapters"] = adapters
    save_config(cfg)
    return run_server(selftest=False)


def cmd_off():
    cfg = load_config()
    restore_dns(cfg.get("adapters", interface_names()))
    print("[off] restoring upstream DNS on", cfg.get("adapters", []))
    return 0


def cmd_status():
    cfg = load_config()
    print("linked : {}".format("yes" if cfg.get("token") else "no"))
    print("send   : {}".format(reporter.last or "nothing sent yet"))
    print("last   : {} ({})".format(DnsServer.last_domain, DnsServer.last_action))


def run_server(selftest):
    reporter.start()
    server = DnsServer((ADDR, PORT), DnsHandler)
    print("[dns] listening on {}:{} - Ctrl+C to stop".format(ADDR, PORT))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        reporter.stop()
        server.shutdown()
    print("[dns] stopped")
    return 0


def main(argv):
    if argv and argv[0] == "--scheme":
        return handle_scheme(argv[1]) if len(argv) > 1 else 1
    if argv and argv[0] == "--port":
        global PORT
        PORT = int(argv[1]) if len(argv) > 1 else PORT
        return run_server(selftest=True)
    if argv and argv[0] == "link":
        return cmd_link()
    if argv and argv[0] == "on":
        return cmd_on()
    if argv and argv[0] == "off":
        return cmd_off()
    if argv and argv[0] == "status":
        return cmd_status()
    print(__doc__)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))