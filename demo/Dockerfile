# The Immich stub for the public demo (demo/stub.ts): the frozen manifest is baked in, the media
# (demo/data/media, ~950 MB, rebuilt by `node demo/fetch.ts`) is mounted at /media.
# Build from the project root: docker build -f demo/Dockerfile .  (demo/Dockerfile.dockerignore applies)
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
# Only @hono/node-server is needed at run time.
RUN npm ci --omit=dev
COPY demo/stub.ts demo/manifest.ts demo/config.ts demo/manifest.json ./demo/
ENV NODE_ENV=production STUB_PORT=2283 DEMO_MEDIA=/media
USER node
EXPOSE 2283
HEALTHCHECK --interval=5m --timeout=5s --start-period=10s --start-interval=2s \
  CMD wget -qO- http://localhost:2283/api/server/ping > /dev/null || exit 1
CMD ["node", "demo/stub.ts"]
