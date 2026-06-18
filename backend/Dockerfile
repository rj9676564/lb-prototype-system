FROM --platform=$BUILDPLATFORM node:20-alpine AS frontend-builder

WORKDIR /frontend

COPY frontend/package.json frontend/yarn.lock* frontend/package-lock.json* frontend/pnpm-lock.yaml* frontend/.npmrc* ./

RUN \
  if [ -f yarn.lock ]; then yarn --frozen-lockfile; \
  elif [ -f package-lock.json ]; then npm ci; \
  elif [ -f pnpm-lock.yaml ]; then npm install -g pnpm@9 && pnpm install --frozen-lockfile; \
  else echo "Lockfile not found." && exit 1; \
  fi

COPY frontend/ ./

RUN npm run build

FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS backend-builder

RUN apk add --no-cache git gcc musl-dev

WORKDIR /backend

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ ./

RUN CGO_ENABLED=0 go build -o /app/my-pb .

FROM alpine:latest

RUN apk add --no-cache ca-certificates tzdata bash

WORKDIR /app

COPY --from=backend-builder /app/my-pb /app/my-pb
COPY backend/pb_public /app/pb_public
COPY --from=frontend-builder /frontend/dist/. /app/pb_public/

RUN mkdir -p /app/pb_data /app/pb_public/projects

EXPOSE 9000

ENTRYPOINT ["/app/my-pb", "serve", "--http=0.0.0.0:9000", "--dir=/app/pb_data"]
