const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const hpp = require('hpp');
const { errorHandler } = require('./middleware/error-handler');
const logger = require('./logger');

function createServiceApp({ serviceName, corsOrigins }) {
  const app = express();

  // Security
  app.use(helmet());
  app.use(hpp());
  app.use(
    cors({
      origin: corsOrigins || process.env.CORS_ORIGINS?.split(',') || [],
      credentials: true,
    }),
  );

  // Parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Logging
  app.use(
    morgan('short', {
      stream: { write: (msg) => logger.info(msg.trim(), { service: serviceName }) },
    }),
  );

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: serviceName, timestamp: new Date().toISOString() });
  });

  // Readiness check
  app.get('/ready', (_req, res) => {
    const mongoose = require('mongoose');
    const dbReady = mongoose.connection.readyState === 1;
    if (dbReady) {
      res.json({ status: 'ready', service: serviceName });
    } else {
      res.status(503).json({ status: 'not_ready', service: serviceName });
    }
  });

  return app;
}

module.exports = { createServiceApp };