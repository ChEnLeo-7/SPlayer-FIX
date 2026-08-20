# build
FROM node:22-alpine AS builder

# 安装项目锁定版本的 pnpm
RUN npm install -g pnpm@10.28.1

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

# skip postinstall
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .

# add .env.example to .env
RUN [ ! -e ".env" ] && cp .env.example .env || true

# skip native build for web deployment
ENV SKIP_NATIVE_BUILD=true
ENV DOCKER_BUILD=true
ENV NODE_OPTIONS=--max-old-space-size=1536
RUN pnpm exec electron-vite build

# nginx
FROM nginx:1.27-alpine-slim AS app

COPY --from=builder /app/out/renderer /usr/share/nginx/html

RUN chmod -R a+rX /usr/share/nginx/html

COPY --from=builder /app/nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=builder /app/docker-entrypoint.sh /docker-entrypoint.sh
COPY --from=builder /app/scripts/local-favorites-server.mjs /local-favorites-server.mjs

RUN apk add --no-cache npm python3 \
    && npm install -g @unblockneteasemusic/server @neteasecloudmusicapienhanced/api \
    && mkdir -p /data/splayer \
    && sed -i 's/\r$//' /docker-entrypoint.sh \
    && chmod +x /docker-entrypoint.sh

ENV NODE_TLS_REJECT_UNAUTHORIZED=0

ENTRYPOINT ["/docker-entrypoint.sh"]

CMD ["node", "/usr/local/lib/node_modules/@neteasecloudmusicapienhanced/api/app.js"]
