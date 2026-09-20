# ==========================================
# 阶段 1：构建前端
# ==========================================
FROM --platform=$BUILDPLATFORM node:20-alpine AS frontend-builder

WORKDIR /frontend

COPY frontend/package.json frontend/yarn.lock* frontend/package-lock.json* frontend/pnpm-lock.yaml* frontend/.npmrc* ./

RUN \
  if [ -f yarn.lock ]; then yarn --frozen-lockfile; \
  elif [ -f package-lock.json ]; then npm ci; \
  elif [ -f pnpm-lock.yaml ]; then npm install -g pnpm@9 && pnpm install --frozen-lockfile; \
  else npm install; \
  fi

COPY frontend/ ./
RUN npm run build

# ==========================================
# 阶段 2：Go 后端编译
# ==========================================
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS backend-builder

ARG TARGETOS
ARG TARGETARCH

RUN apk add --no-cache git

WORKDIR /backend

COPY backend/go.mod backend/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download

COPY backend/ ./

RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -ldflags="-s -w" -o /app/my-pb .

# ==========================================
# 阶段 3：最终运行镜像
# ==========================================
FROM alpine:latest

RUN apk add --no-cache ca-certificates tzdata bash git openssh-client

WORKDIR /app

COPY --from=backend-builder /app/my-pb /app/my-pb
COPY backend/pb_public /app/pb_public
COPY --from=frontend-builder /frontend/dist/. /app/pb_public/

RUN mkdir -p /app/pb_data /app/pb_public/projects

EXPOSE 9000

ENTRYPOINT ["/app/my-pb", "serve", "--http=0.0.0.0:9000", "--dir=/app/pb_data"]
