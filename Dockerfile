FROM node:24-alpine AS build
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
USER node
EXPOSE 8080
HEALTHCHECK --interval=5m --timeout=5s --start-period=10s --start-interval=2s \
  CMD wget -qO- http://localhost:8080/api/health > /dev/null || exit 1
CMD ["node", "server/main.ts"]
