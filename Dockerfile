# The build stage runs on the build machine's platform even for an arm64 image: its output (the web
# build and production node_modules) is plain JS, so no emulation is needed. A dependency with
# native code in production would break that: build it per target platform then.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# Node 24 runs the server's TypeScript directly (type stripping), so only the web part is built.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 WEB_DIR=/app/dist/web
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist/web ./dist/web
COPY package.json ./
COPY server ./server
COPY shared ./shared
USER node
EXPOSE 8080
HEALTHCHECK --interval=5m --timeout=5s --start-period=10s --start-interval=2s \
  CMD wget -qO- http://localhost:8080/api/health > /dev/null || exit 1
CMD ["node", "server/main.ts"]
