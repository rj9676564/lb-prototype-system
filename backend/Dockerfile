# Build stage
FROM golang:1.25-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git gcc musl-dev

WORKDIR /app

# Copy dependency files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build the application
# CGO_ENABLED=0 ensures a static binary for smaller/safer images
RUN CGO_ENABLED=0 go build -o my-pb .

# Final stage
FROM alpine:latest

# Install runtime dependencies
RUN apk add --no-cache ca-certificates tzdata bash

WORKDIR /app

# Copy the binary from builder
COPY --from=builder /app/my-pb /app/my-pb

# Copy static files directory
# Note: Ensure pb_public exists in your context
COPY pb_public /app/pb_public

# Create data directory for PocketBase persistence
RUN mkdir -p /app/pb_data

# Expose the port used in the application
EXPOSE 9000

# Set entrypoint to run the server
# Default to 0.0.0.0 so it's accessible from outside the container
ENTRYPOINT ["/app/my-pb", "serve", "--http=0.0.0.0:9000", "--dir=/app/pb_data"]
