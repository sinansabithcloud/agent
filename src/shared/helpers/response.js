function apiResponse(res, statusCode, data, meta = null) {
  const response = {
    success: statusCode < 400,
    data,
    ...(meta && { meta }),
    timestamp: new Date().toISOString(),
  };
  return res.status(statusCode).json(response);
}

module.exports = { apiResponse };
