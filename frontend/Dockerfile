# Multi-arch friendly frontend image based on official Node.
FROM node:20-alpine AS base

WORKDIR /app

FROM base as deps

COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* .npmrc* ./

RUN \
  if [ -f yarn.lock ]; then yarn --frozen-lockfile; \
  elif [ -f package-lock.json ]; then npm ci; \
  elif [ -f pnpm-lock.yaml ]; then npm install -g pnpm@9 && pnpm install --frozen-lockfile; \
  else echo "Lockfile not found." && exit 1; \
  fi

FROM base as builder

ENV NODE_ENV production
ARG VITE_BACKEND_BASE_URL
ENV VITE_BACKEND_BASE_URL=${VITE_BACKEND_BASE_URL}

COPY --from=deps /app/node_modules ./node_modules

COPY . .

RUN npm run build

FROM base as runner

ENV NODE_ENV production

RUN npm install -g serve

COPY --from=builder /app/dist ./

EXPOSE 3000

USER node

CMD ["serve", "-s", ".", "-l", "3000"]
