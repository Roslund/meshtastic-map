FROM node:lts-alpine

WORKDIR /app

RUN apk add --no-cache openssl

# Copy only package files and install deps
# This layer will be cached as long as package*.json don't change
COPY package*.json package-lock.json* ./
RUN npm ci

# Copy the rest of the source
COPY . .

EXPOSE 8080