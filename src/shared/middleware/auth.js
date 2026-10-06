const jwt = require('jsonwebtoken');
const { AppError } = require('./error-handler');
const { getSessionVersion } = require('../session');

async function authenticate(req, _res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError('Authentication required', 401);
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Single active session: reject access tokens minted before the user's most
    // recent login. Only enforced when the token carries a version (tv) and the
    // shared store has a current version; otherwise fail-open (Redis down or
    // pre-existing tokens) so users are never locked out by infrastructure.
    if (decoded.id && decoded.tv !== undefined) {
      const current = await getSessionVersion(decoded.id);
      if (current !== null && Number(current) !== Number(decoded.tv)) {
        throw new AppError('You have been signed out because your account was used on another device.', 401);
      }
    }

    req.user = decoded;
    next();
  } catch (error) {
    if (error instanceof AppError) return next(error);
    if (error.name === 'TokenExpiredError') {
      return next(new AppError('Token expired', 401));
    }
    next(new AppError('Invalid token', 401));
  }
}

function authorize(...roles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }
    if (roles.length && !roles.includes(req.user.role)) {
      return next(new AppError('Insufficient permissions', 403));
    }
    next();
  };
}

module.exports = { authenticate, authorize };
