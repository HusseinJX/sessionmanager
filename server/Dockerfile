FROM node:20-bookworm

RUN apt-get update && apt-get install -y build-essential python3 procps && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install server dependencies
COPY server/package*.json ./server/
RUN cd server && npm install

# Build web UI
COPY web/package*.json ./web/
RUN cd web && npm install

COPY web/ ./web/
RUN cd web && npm run build

# Build server
COPY server/ ./server/
RUN cd server && npm run build

# Copy web UI dist to where server expects it
RUN cp -r web/dist server/web-ui

WORKDIR /app/server

ENV PORT=8080
ENV SM_DATA_DIR=/data
VOLUME /data

EXPOSE 8080

CMD ["node", "dist/index.js"]
