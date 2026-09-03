# ---------- 构建前端 ----------
FROM node:22-slim AS web-build
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---------- 运行时 ----------
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund
COPY . .
COPY --from=web-build /web/dist ./web/dist
EXPOSE 3001 3002
CMD ["npx", "tsx", "src/index.ts"]
