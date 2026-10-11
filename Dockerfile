# build
FROM node:22-alpine AS builder

# 安装项目锁定版本的 pnpm
RUN npm install -g pnpm@10.28.1

# 构建 SQLite 原生模块
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

# skip postinstall
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm rebuild better-sqlite3

COPY . .

# add .env.example to .env
RUN [ ! -e ".env" ] && cp .env.example .env || true

# skip native build for web deployment
ENV SKIP_NATIVE_BUILD=true
ENV DOCKER_BUILD=true
ENV NODE_OPTIONS=--max-old-space-size=1024
RUN pnpm exec electron-vite build

# 最终镜像仅保留运行依赖
RUN CI=true pnpm prune --prod --ignore-scripts \
    && pnpm rebuild better-sqlite3

# nginx 与账户服务
FROM node:22-alpine AS app

COPY --from=builder /app/out/renderer /usr/share/nginx/html
COPY --from=builder /app/account /app/account
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/package.json /app/package.json

RUN chmod -R a+rX /usr/share/nginx/html

COPY --from=builder /app/nginx.conf /etc/nginx/http.d/default.conf

COPY --from=builder /app/docker-entrypoint.sh /docker-entrypoint.sh
COPY --from=builder /app/scripts/local-favorites-server.mjs /local-favorites-server.mjs
RUN apk add --no-cache nginx python3 \
    && mkdir -p /data/splayer \
    && mkdir -p /etc/nginx/snippets \
    && sed -i 's/\r$//' /docker-entrypoint.sh \
    && chmod +x /docker-entrypoint.sh

ENV SPLAYER_ACCOUNT_DB=/data/splayer/splayer-account.db

ENTRYPOINT ["/docker-entrypoint.sh"]

CMD ["node", "/app/node_modules/@neteasecloudmusicapienhanced/api/app.js"]
