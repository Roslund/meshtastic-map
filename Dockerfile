FROM node:lts-alpine AS build

WORKDIR /app

# Copy only package files and install deps
# This layer will be cached as long as package*.json don't change
COPY package*.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

# Copy the rest of your source
COPY . .

FROM node:lts-alpine

RUN apk add --no-cache openssl

USER node:node

WORKDIR /app

COPY --from=build /app .


EXPOSE 8080