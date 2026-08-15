FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV CONTRACTOR_AI_BIND_HOST=0.0.0.0
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY server.js operating-ledger.js framework-catalog.js contractor-framework-catalog.json weather-service.js evidence-storage.js hai-connector.js postgres-sync-database.js postgres-sync-worker.js backup-manifest.js runtime-lock.js ./
COPY scripts/restore-local-backup.js ./scripts/restore-local-backup.js
COPY scripts/migrate-local-backup-to-hosted.js ./scripts/migrate-local-backup-to-hosted.js
RUN mkdir -p /var/lib/contractor-ai/uploads && chown -R node:node /var/lib/contractor-ai
USER node
ENV STATE_FILE=/var/lib/contractor-ai/server-state.json
ENV LEDGER_DB_FILE=/var/lib/contractor-ai/contractor-ledger.sqlite
ENV UPLOAD_DIR=/var/lib/contractor-ai/uploads
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=8s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
