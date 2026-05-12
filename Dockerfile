FROM node:22-slim AS base
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
RUN corepack enable pnpm

WORKDIR /app

# 克隆 stello SDK（公开仓库）
ARG STELLO_REF=main
RUN git clone --depth 1 --branch ${STELLO_REF} https://github.com/stello-agent/stello.git stello

# 复制依赖定义 + 根 tsconfig
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/

# 安装依赖
RUN pnpm install --frozen-lockfile

# 复制源码
COPY packages/ packages/
COPY market/ market/

# 构建（顺序：session → core → server + web）
RUN pnpm --filter @stello-ai/session run build && \
    pnpm --filter @stello-ai/core run build && \
    pnpm --filter @mindkit/server run build && \
    pnpm --filter @mindkit/web run build

# 确保 data 目录存在
RUN mkdir -p data/spaces

ENV NODE_ENV=production
ENV HOST=0.0.0.0
EXPOSE 3000

CMD ["node", "packages/server/dist/index.js"]
