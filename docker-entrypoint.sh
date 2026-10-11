#!/bin/sh

set -e
umask 077

# 生成歌曲解析专用 Cookie 配置
PLAYBACK_COOKIE_FILE="${SPLAYER_NETEASE_PLAYBACK_COOKIE_FILE:-/run/secrets/netease_playback_cookie}"
PLAYBACK_COOKIE_INCLUDE="/etc/nginx/snippets/netease-playback-cookie.conf"
mkdir -p "$(dirname "$PLAYBACK_COOKIE_INCLUDE")"
: > "$PLAYBACK_COOKIE_INCLUDE"
if [ -f "$PLAYBACK_COOKIE_FILE" ]; then
    PLAYBACK_COOKIE=$(cat "$PLAYBACK_COOKIE_FILE")
    if [ "$(printf '%s' "$PLAYBACK_COOKIE" | wc -l)" -ne 0 ] \
        || ! printf '%s' "$PLAYBACK_COOKIE" | grep -Eq '^MUSIC_U=[A-Za-z0-9_+/=-]+$'; then
        echo "Invalid SPlayer playback cookie secret" >&2
        exit 1
    fi
    printf 'proxy_set_header Cookie "%s";\n' "$PLAYBACK_COOKIE" > "$PLAYBACK_COOKIE_INCLUDE"
fi
chmod 600 "$PLAYBACK_COOKIE_INCLUDE"

# 启动 Music Together UNM 兼容代理
UNM_ENABLED="${SPLAYER_MUSIC_TOGETHER_UNM_ENABLED:-false}"
UNM_PID=""
if [ "$UNM_ENABLED" = "true" ]; then
    UNM_SOURCES="${SPLAYER_MUSIC_TOGETHER_UNM_SOURCES:-pyncmd bodian kuwo}"
    if ! printf '%s' "$UNM_SOURCES" | grep -Eq '^[a-z0-9_-]+( [a-z0-9_-]+)*$'; then
        echo "Invalid SPlayer Music Together UNM sources" >&2
        exit 1
    fi
    start_music_together_unm() {
        set -- $UNM_SOURCES
        NETEASE_COOKIE="$PLAYBACK_COOKIE" \
        ENABLE_FLAC=true \
        FOLLOW_SOURCE_ORDER=true \
        SELECT_MAX_BR=true \
        SEARCH_ALBUM=true \
        node /app/node_modules/@unblockneteasemusic/server/app.js \
            -p 16380 \
            -a 0.0.0.0 \
            -s \
            -o "$@" \
            2>&1 &
        UNM_PID=$!
    }
    start_music_together_unm
elif [ "$UNM_ENABLED" != "false" ]; then
    echo "SPLAYER_MUSIC_TOGETHER_UNM_ENABLED must be true or false" >&2
    exit 1
fi

# 启动账户服务
node /app/account/index.mjs 2>&1 &
ACCOUNT_PID=$!

# 启动本地收藏服务
node /local-favorites-server.mjs 2>&1 &
FAVORITES_PID=$!

# 确认后台服务成功启动
sleep 1
if ! kill -0 "$ACCOUNT_PID" 2>/dev/null; then
    echo "SPlayer account service failed to start" >&2
    exit 1
fi
if ! kill -0 "$FAVORITES_PID" 2>/dev/null; then
    echo "SPlayer local favorites service failed to start" >&2
    exit 1
fi
if [ -n "$UNM_PID" ]; then
    ready=0
    for _ in $(seq 1 30); do
        if ! kill -0 "$UNM_PID" 2>/dev/null; then
            echo "SPlayer Music Together UNM proxy failed to start" >&2
            exit 1
        fi
        if node -e '
          const net = require("net");
          const socket = net.connect(16380, "127.0.0.1");
          socket.once("connect", () => { socket.destroy(); process.exit(0); });
          socket.once("error", () => process.exit(1));
          setTimeout(() => process.exit(1), 500).unref();
        ' 2>/dev/null; then
            ready=1
            break
        fi
        sleep 1
    done
    if [ "$ready" -ne 1 ]; then
        echo "SPlayer Music Together UNM proxy did not listen on port 16380" >&2
        exit 1
    fi
fi

# start the nginx daemon
nginx

# start the main process
exec "$@"
