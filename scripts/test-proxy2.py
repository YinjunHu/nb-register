import requests, warnings
from urllib3.exceptions import InsecureRequestWarning

for scheme in ["socks5://192.168.3.23:7891", "socks5h://192.168.3.23:7891"]:
    print(f"\n=== {scheme} ===")
    proxies = {"http": scheme, "https": scheme}
    for url in ["https://api.ipify.org", "https://icanhazip.com"]:
        try:
            with warnings.catch_warnings():
                warnings.filterwarnings("ignore", category=InsecureRequestWarning)
                r = requests.get(url, proxies=proxies, timeout=10, verify=False)
            print(f"  {url} -> {r.text.strip()}")
            break
        except Exception as e:
            print(f"  {url} -> {type(e).__name__}: {e}")
