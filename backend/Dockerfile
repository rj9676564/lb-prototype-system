# === 阶段 1：Go 后端编译 ===
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

# === 阶段 2：最终运行镜像 ===
FROM alpine:latest

RUN apk add --no-cache ca-certificates tzdata bash

WORKDIR /app

COPY --from=backend-builder /app/my-pb /app/my-pb
COPY backend/pb_public /app/pb_public
COPY frontend/dist/. /app/pb_public/

RUN mkdir -p /app/pb_data /app/pb_public/projects

EXPOSE 9000

ENTRYPOINT ["/app/my-pb", "serve", "--http=0.0.0.0:9000", "--dir=/app/pb_data"]
