const { validationResult } = require('express-validator');
const { AppError } = require('./error-handler');

function validate(validations) {
  return async (req, _res, next) => {
    for (const validation of validations) {
      await validation.run(req);
    }

    const errors = validationResult(req);
    if (errors.isEmpty()) return next();

    const extractedErrors = errors.array().map((err) => ({
      field: err.path,
      message: err.msg,
    }));

    next(new AppError('Validation failed', 422, extractedErrors));
  };
}

module.exports = { validate };
