# ==========================================
# 阶段 1：构建前端
# ==========================================
FROM --platform=$BUILDPLATFORM node:20-alpine AS frontend-builder

WORKDIR /frontend

# 复制前端依赖定义
COPY frontend/package.json frontend/yarn.lock* frontend/package-lock.json* frontend/pnpm-lock.yaml* frontend/.npmrc* ./

RUN \
  if [ -f yarn.lock ]; then yarn --frozen-lockfile; \
  elif [ -f package-lock.json ]; then npm ci; \
  elif [ -f pnpm-lock.yaml ]; then npm install -g pnpm@9 && pnpm install --frozen-lockfile; \
  else npm install; \
  fi

# 复制前端源码并打包
COPY frontend/ ./
RUN npm run build

# ==========================================
# 阶段 2：编译 Go 后端
# ==========================================
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS backend-builder

ARG TARGETOS
ARG TARGETARCH

RUN apk add --no-cache git

WORKDIR /backend

# 复制后端依赖定义
COPY backend/go.mod backend/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download

# 复制后端源码并编译
COPY backend/ ./
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -ldflags="-s -w" -o /app/my-pb .

# ==========================================
# 阶段 3：最终一体化运行镜像
# ==========================================
FROM alpine:latest

RUN apk add --no-cache ca-certificates tzdata bash

WORKDIR /app

# 复制后端可执行文件
COPY --from=backend-builder /app/my-pb /app/my-pb

# 复制后端内置静态资源
COPY backend/pb_public /app/pb_public

# 将前端构建产物合并至 pb_public 静态目录，由 PocketBase 统一服务
COPY --from=frontend-builder /frontend/dist/. /app/pb_public/

# 创建持久化数据与原型解压目录
RUN mkdir -p /app/pb_data /app/pb_public/projects

EXPOSE 9000

ENTRYPOINT ["/app/my-pb", "serve", "--http=0.0.0.0:9000", "--dir=/app/pb_data"]
