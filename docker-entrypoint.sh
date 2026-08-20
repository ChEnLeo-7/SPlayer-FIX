#!/bin/sh

set -e

# 启动解锁服务
UNBLOCK_BIN="/usr/local/bin/unblockneteasemusic"
if [ ! -x "$UNBLOCK_BIN" ]; then
    echo "unblockneteasemusic executable not found: $UNBLOCK_BIN" >&2
    exit 1
fi

"$UNBLOCK_BIN" \
    -p "${UNBLOCK_PORTS:-80:443}" \
    -s \
    -f "${NETEASE_SERVER_IP:-220.197.30.65}" \
    -o ${UNBLOCK_SOURCES:-kugou bodian pyncmd} \
    2>&1 &
UNBLOCK_PID=$!

# 等待解锁服务监听 HTTPS 端口，避免 API 提前启动
ready=0
for _ in $(seq 1 30); do
    if ! kill -0 "$UNBLOCK_PID" 2>/dev/null; then
        echo "unblockneteasemusic exited before port 443 became ready" >&2
        exit 1
    fi
    if node -e '
      const tls = require("tls");
      const socket = tls.connect({ host: "127.0.0.1", port: 443, rejectUnauthorized: false });
      socket.once("secureConnect", () => { socket.destroy(); process.exit(0); });
      socket.once("error", () => process.exit(1));
      setTimeout(() => process.exit(1), 1000);
    ' 2>/dev/null; then
        ready=1
        break
    fi
    sleep 1
done

if [ "$ready" -ne 1 ]; then
    echo "unblockneteasemusic did not listen on 127.0.0.1:443" >&2
    exit 1
fi

# start local favorites service in the background
node /local-favorites-server.mjs 2>&1 &

# point the neteasemusic address to the unblock service
if ! grep -q "music.163.com" /etc/hosts; then
    echo "127.0.0.1 music.163.com" >> /etc/hosts
fi
if ! grep -q "interface.music.163.com" /etc/hosts; then
    echo "127.0.0.1 interface.music.163.com" >> /etc/hosts
fi
if ! grep -q "interface3.music.163.com" /etc/hosts; then
    echo "127.0.0.1 interface3.music.163.com" >> /etc/hosts
fi
if ! grep -q "interface.music.163.com.163jiasu.com" /etc/hosts; then
    echo "127.0.0.1 interface.music.163.com.163jiasu.com" >> /etc/hosts
fi
if ! grep -q "interface3.music.163.com.163jiasu.com" /etc/hosts; then
    echo "127.0.0.1 interface3.music.163.com.163jiasu.com" >> /etc/hosts
fi

# start the nginx daemon
nginx

# start the main process
exec "$@"
