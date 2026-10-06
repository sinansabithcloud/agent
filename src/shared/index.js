const logger = require('./logger');
const { connectDB } = require('./database');
const { createServiceApp } = require('./service-factory');
const { authenticate, authorize } = require('./middleware/auth');
const { validate } = require('./middleware/validate');
const { errorHandler, AppError } = require('./middleware/error-handler');
const EventBus = require('./event-bus');
const CacheManager = require('./cache');
const { apiResponse } = require('./helpers/response');
const constants = require('./constants');

module.exports = {
  logger,
  connectDB,
  createServiceApp,
  authenticate,
  authorize,
  validate,
  errorHandler,
  AppError,
  EventBus,
  CacheManager,
  apiResponse,
  constants,
};
