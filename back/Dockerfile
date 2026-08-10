# DOTCADE 백엔드 — git 바이너리 필요(게임팩 레포 관리)라 Docker 런타임 사용
FROM node:20-alpine
RUN apk add --no-cache git
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
CMD ["node", "server/index.js"]
