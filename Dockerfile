# SPARK for a NAS or any Docker host (x86 or ARM). See NAS.md.
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY . .
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "--max-old-space-size=256", "server.js"]
