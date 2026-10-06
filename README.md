# TawseelQ GPS Tracking Service

Real-time truck tracking with WebSocket support and offline sync.

## Setup

```bash
cp .env.example .env
npm install
npm run dev
```

## Docker

```bash
docker build -t tawseelq-gps-tracking .
docker run -p 3006:3006 --env-file .env tawseelq-gps-tracking
```
