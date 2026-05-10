#!/bin/bash
set -e

# Switch mihomo proxy to get different exit IP
curl -s -X PUT http://192.168.3.23:9090/proxies/PROXIES \
  -H "Content-Type: application/json" \
  -d '{"name":"自动选择"}'
echo "Proxy switched"

sleep 2

# Verify GitHub API is accessible
echo "Testing GitHub API..."
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
  --proxy socks5h://192.168.3.23:7891 \
  https://api.github.com/repos/daijro/camoufox/releases)
echo "GitHub API response: $HTTP_CODE"

if [ "$HTTP_CODE" = "403" ]; then
  echo "Still rate limited. Trying different proxy node..."
  curl -s -X PUT http://192.168.3.23:9090/proxies/PROXIES \
    -H "Content-Type: application/json" \
    -d '{"name":"🇺🇸 美国专供"}'
  sleep 2
  HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
    --proxy socks5h://192.168.3.23:7891 \
    https://api.github.com/repos/daijro/camoufox/releases)
  echo "GitHub API response after switch: $HTTP_CODE"
fi

if [ "$HTTP_CODE" = "403" ]; then
  echo "Still rate limited. Trying JP node..."
  curl -s -X PUT http://192.168.3.23:9090/proxies/PROXIES \
    -H "Content-Type: application/json" \
    -d '{"name":"🇯🇵 日本专供"}'
  sleep 2
  HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
    --proxy socks5h://192.168.3.23:7891 \
    https://api.github.com/repos/daijro/camoufox/releases)
  echo "GitHub API response after JP switch: $HTTP_CODE"
fi

echo "Building camoufox-base image..."
cd ~/nb-register
docker build --network host \
  --build-arg CAMOUFOX_FETCH_PROXY=http://192.168.3.23:7890 \
  -t nb-register-camoufox-base:latest \
  -f docker/camoufox-base/Dockerfile \
  docker/camoufox-base/

echo "camoufox-base build complete!"
