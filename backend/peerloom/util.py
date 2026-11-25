import os
import re
import socket

_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def safe_filename(name, fallback="file"):
    """Reduce any received file name to a harmless base name (blocks '../../x' tricks)."""
    name = str(name).replace("\\", "/").split("/")[-1]
    name = _CONTROL.sub("", name).strip().strip(".")
    return name[:120] or fallback


def unique_path(directory, name):
    """directory/name, or directory/'name (1).ext' when that file already exists."""
    base, ext = os.path.splitext(name)
    candidate, counter = name, 1
    while os.path.exists(os.path.join(directory, candidate)) or os.path.exists(os.path.join(directory, candidate + ".part")):
        candidate = f"{base} ({counter}){ext}"
        counter += 1
    return os.path.join(directory, candidate)


def local_addresses():
    """Non-loopback IPv4 addresses of this computer (what a friend on the same Wi-Fi would type)."""
    found = []
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(("10.255.255.255", 1))          # UDP connect sends nothing; it only picks a route
        found.append(probe.getsockname()[0])
        probe.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.append(info[4][0])
    except OSError:
        pass
    unique = []
    for ip in found:
        if not ip.startswith("127.") and ip != "0.0.0.0" and ip not in unique:
            unique.append(ip)
    return unique


def human_bytes(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
