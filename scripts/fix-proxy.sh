#!/bin/bash
set -e
echo "Current proxy group:"
curl -s http://127.0.0.1:9090/proxies/PROXIES | python3 -c 'import sys,json;d=json.load(sys.stdin);print("  now:",d["now"])'

echo "Switching to 自动选择..."
curl -s -X PUT http://127.0.0.1:9090/proxies/PROXIES \
  -H "Content-Type: application/json" \
  -d '{"name":"自动选择"}'

sleep 3
echo "After switch:"
curl -s http://127.0.0.1:9090/proxies/PROXIES | python3 -c 'import sys,json;d=json.load(sys.stdin);print("  now:",d["now"])'

echo ""
echo "Testing connectivity..."
curl -sS --max-time 15 --proxy socks5h://127.0.0.1:7891 https://httpbin.org/ip 2>&1
echo ""
echo "Done"
