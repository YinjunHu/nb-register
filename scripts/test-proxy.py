import requests
import warnings
from urllib3.exceptions import InsecureRequestWarning

proxy_socks5 = "socks5://host.docker.internal:7891"
proxy_socks5h = "socks5h://host.docker.internal:7891"

urls = [
    "https://api.ipify.org",
    "https://checkip.amazonaws.com",
    "https://ipinfo.io/ip",
    "https://icanhazip.com",
    "https://ifconfig.co/ip",
    "https://ipecho.net/plain",
]

for scheme in [proxy_socks5, proxy_socks5h]:
    print(f"\n=== Testing with {scheme} ===")
    proxies = {"http": scheme, "https": scheme}
    for url in urls:
        try:
            with warnings.catch_warnings():
                warnings.filterwarnings("ignore", category=InsecureRequestWarning)
                r = requests.get(url, proxies=proxies, timeout=10, verify=False)
            print(f"  {url} -> {r.text.strip()}")
            break
        except Exception as e:
            print(f"  {url} -> FAIL: {type(e).__name__}: {e}")
