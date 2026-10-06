require('dotenv').config();
process.env.SERVICE_NAME = 'gps-tracking';

const http = require('http');
const { createServiceApp, connectDB, errorHandler, logger, EventBus, CacheManager } = require('./shared');
const gpsRoutes = require('./routes/gps.routes');
const WebSocketServer = require('./ws/ws-server');

const PORT = process.env.GPS_SERVICE_PORT || 3006;
const app = createServiceApp({ serviceName: 'gps-tracking' });

// ── Routes ──
app.use('/gps', gpsRoutes);

// ── Error Handler ──
app.use(errorHandler);

// ── Start ──
(async () => {
  await connectDB(process.env.GPS_DB_URI);

  const cache = new CacheManager(process.env.GPS_REDIS_URL || process.env.REDIS_URL);
  await cache.connect();
  app.locals.cache = cache;

  const eventBus = new EventBus();
  await eventBus.connect(process.env.RABBITMQ_URL);
  app.locals.eventBus = eventBus;

  const server = http.createServer(app);

  // WebSocket for real-time GPS streaming
  const wss = new WebSocketServer(server, cache, eventBus);
  app.locals.wss = wss;

  server.listen(PORT, () => {
    logger.info(`GPS Tracking service running on port ${PORT} (HTTP + WS)`);
  });
})();
