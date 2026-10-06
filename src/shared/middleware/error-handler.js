const logger = require('../logger');

class AppError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

function errorHandler(err, _req, res, _next) {
  // Handle Mongoose ValidationError
  if (err.name === 'ValidationError' && err.errors) {
    const details = Object.entries(err.errors).map(([field, e]) => ({
      field,
      message: e.message,
    }));
    return res.status(422).json({
      success: false,
      error: { message: 'Validation failed', details },
    });
  }

  // Handle Mongoose CastError
  if (err.name === 'CastError') {
    return res.status(422).json({
      success: false,
      error: { message: `Invalid value for field "${err.path}": expected ${err.kind}` },
    });
  }

  // Handle duplicate key (MongoDB 11000)
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'field';
    return res.status(409).json({
      success: false,
      error: { message: `Duplicate value for "${field}"` },
    });
  }

  const statusCode = err.statusCode || 500;
  const isProduction = process.env.NODE_ENV === 'production';

  if (statusCode >= 500) {
    logger.error('Server error', {
      message: err.message,
      stack: err.stack,
      statusCode,
    });
  }

  res.status(statusCode).json({
    success: false,
    error: {
      message: err.isOperational ? err.message : 'Internal server error',
      ...(err.details && { details: err.details }),
      ...(!isProduction && { stack: err.stack }),
    },
  });
}

module.exports = { AppError, errorHandler };
