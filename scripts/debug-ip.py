#!/usr/bin/env python3
"""Debug the exact IP detection path Camoufox uses."""
import socket
import requests
import warnings
from urllib3.exceptions import InsecureRequestWarning

proxy_str = "socks5://host.docker.internal:7891"
proxies = {"http": proxy_str, "https": proxy_str}

# 1) DNS resolution test
print("=== DNS Resolution ===")
for host in ["api.ipify.org", "host.docker.internal", "checkip.amazonaws.com"]:
    try:
        ip = socket.getaddrinfo(host, 443, socket.AF_INET)
        print(f"  {host} -> {ip[0][4][0]}")
    except Exception as e:
        print(f"  {host} -> FAIL: {e}")

# 2) Direct socket test to proxy
print("\n=== Proxy Socket Test ===")
try:
    s = socket.create_connection(("host.docker.internal", 7891), timeout=5)
    print(f"  Connected to proxy: {s.getpeername()}")
    s.close()
except Exception as e:
    print(f"  FAILED: {e}")

# 3) requests through proxy
print("\n=== Requests through socks5:// ===")
urls = [
    "https://api.ipify.org",
    "https://checkip.amazonaws.com",
    "https://icanhazip.com",
]
for url in urls:
    try:
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=InsecureRequestWarning)
            r = requests.get(url, proxies=proxies, timeout=5, verify=False)
        print(f"  {url} -> {r.status_code} {r.text.strip()[:50]}")
        break
    except Exception as e:
        print(f"  {url} -> {type(e).__name__}: {e}")

# 4) Also test socks5h
print("\n=== Requests through socks5h:// ===")
proxies_h = {"http": "socks5h://host.docker.internal:7891", "https": "socks5h://host.docker.internal:7891"}
for url in urls:
    try:
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=InsecureRequestWarning)
            r = requests.get(url, proxies=proxies_h, timeout=5, verify=False)
        print(f"  {url} -> {r.status_code} {r.text.strip()[:50]}")
        break
    except Exception as e:
        print(f"  {url} -> {type(e).__name__}: {e}")
