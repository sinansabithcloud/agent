const { Router } = require('express');
const { body, param, query } = require('express-validator');
const { authenticate, authorize, validate, apiResponse, AppError } = require('../shared');
const GpsPosition = require('../models/gps-position.model');

const router = Router();
router.use(authenticate);

// ── Get Latest Position for a Truck ──
router.get(
  '/trucks/:truckId/latest',
  async (req, res, next) => {
    try {
      // Try cache first
      const cached = await req.app.locals.cache?.get(`gps:truck:${req.params.truckId}`);
      if (cached) {
        return apiResponse(res, 200, { ...cached, source: 'cache' });
      }

      const position = await GpsPosition.findOne({ truckId: req.params.truckId })
        .sort({ recordedAt: -1 });
      if (!position) throw new AppError('No position data found for this truck', 404);
      apiResponse(res, 200, position);
    } catch (error) {
      next(error);
    }
  },
);

// ── Get Position History for a Truck ──
router.get(
  '/trucks/:truckId/history',
  validate([
    query('from').optional().isISO8601(),
    query('to').optional().isISO8601(),
    query('limit').optional().isInt({ min: 1, max: 10000 }),
  ]),
  async (req, res, next) => {
    try {
      const { truckId } = req.params;
      const filter = { truckId };

      if (req.query.from || req.query.to) {
        filter.recordedAt = {};
        if (req.query.from) filter.recordedAt.$gte = new Date(req.query.from);
        if (req.query.to) filter.recordedAt.$lte = new Date(req.query.to);
      }

      const limit = parseInt(req.query.limit) || 1000;
      const positions = await GpsPosition.find(filter)
        .sort({ recordedAt: -1 })
        .limit(limit)
        .select('position recordedAt connectivity isOfflineSync eventType speed');

      apiResponse(res, 200, positions, { count: positions.length });
    } catch (error) {
      next(error);
    }
  },
);

// ── Get All Active Trucks (Fleet Overview) ──
router.get(
  '/fleet/active',
  authorize('admin', 'dispatcher', 'inspector'),
  async (req, res, next) => {
    try {
      const cutoff = Date.now() - 30 * 60 * 1000;
      const cache = req.app.locals.cache;

      // Fast path: serve the fleet snapshot straight from Redis so the hot
      // dashboard poll avoids a Mongo aggregation over ~30 min of history.
      if (cache && typeof cache.hgetAllValues === 'function') {
        const entries = await cache.hgetAllValues('gps:fleet');
        if (entries.length) {
          const fresh = [];
          const stale = [];
          for (const e of entries) {
            if (e && new Date(e.recordedAt).getTime() >= cutoff) fresh.push(e);
            else if (e && e._id) stale.push(e._id);
          }
          if (stale.length) cache.hdel('gps:fleet', stale); // best-effort cleanup
          return apiResponse(res, 200, fresh, { count: fresh.length });
        }
      }

      // Fallback: latest position per truck from the last 30 minutes. Used when
      // Redis is unavailable or the snapshot is empty (e.g. after a restart).
      const positions = await GpsPosition.aggregate([
        { $match: { recordedAt: { $gte: new Date(cutoff) } } },
        { $sort: { recordedAt: -1 } },
        {
          $group: {
            _id: '$truckId',
            position: { $first: '$position' },
            recordedAt: { $first: '$recordedAt' },
            connectivity: { $first: '$connectivity' },
            driverId: { $first: '$driverId' },
            manifestId: { $first: '$manifestId' },
            engineStatus: { $first: '$engineStatus' },
            speed: { $first: '$position.speed' },
          },
        },
      ]);

      apiResponse(res, 200, positions, { count: positions.length });
    } catch (error) {
      next(error);
    }
  },
);

// ── Batch Upload Positions (REST fallback for offline sync) ──
router.post(
  '/sync',
  validate([body('positions').isArray({ min: 1, max: 1000 })]),
  async (req, res, next) => {
    try {
      const docs = req.body.positions.map((pos) => ({
        truckId: pos.truckId,
        driverId: req.user.id,
        manifestId: pos.manifestId,
        position: pos.position,
        connectivity: 'offline',
        isOfflineSync: true,
        recordedAt: new Date(pos.timestamp),
        syncedAt: new Date(),
        batteryLevel: pos.batteryLevel,
        engineStatus: pos.engineStatus,
        eventType: pos.eventType || 'periodic',
      }));

      const result = await GpsPosition.insertMany(docs, { ordered: false });

      // Keep the Redis fleet snapshot in sync so GET /gps/fleet/active can be
      // served without a Mongo aggregation. Best-effort; never fails the request.
      const cache = req.app.locals.cache;
      if (cache && typeof cache.hset === 'function') {
        const latestByTruck = new Map();
        for (const d of docs) {
          const current = latestByTruck.get(d.truckId);
          if (!current || new Date(d.recordedAt) > new Date(current.recordedAt)) {
            latestByTruck.set(d.truckId, d);
          }
        }
        for (const d of latestByTruck.values()) {
          await cache.hset('gps:fleet', d.truckId, {
            _id: d.truckId,
            position: d.position,
            recordedAt: d.recordedAt,
            connectivity: d.connectivity,
            driverId: d.driverId,
            manifestId: d.manifestId,
            engineStatus: d.engineStatus,
            speed: d.position?.speed,
          });
        }
      }

      if (req.app.locals.eventBus) {
        await req.app.locals.eventBus.publish('tawseelq.gps', 'gps.offline.sync', {
          driverId: req.user.id,
          count: result.length,
        });
      }

      apiResponse(res, 201, {
        synced: result.length,
        message: `${result.length} positions synced successfully`,
      });
    } catch (error) {
      next(error);
    }
  },
);

// ── Get Connectivity Status for a Truck ──
router.get('/trucks/:truckId/connectivity', async (req, res, next) => {
  try {
    const latest = await GpsPosition.findOne({ truckId: req.params.truckId })
      .sort({ recordedAt: -1 })
      .select('connectivity recordedAt batteryLevel');

    if (!latest) throw new AppError('No data for this truck', 404);

    const lastUpdate = new Date(latest.recordedAt);
    const minutesAgo = (Date.now() - lastUpdate.getTime()) / 60000;

    let status;
    if (minutesAgo < 2) status = 'online';
    else if (minutesAgo < 10) status = 'weak';
    else status = 'offline';

    apiResponse(res, 200, {
      truckId: req.params.truckId,
      connectivity: status,
      lastUpdate: latest.recordedAt,
      minutesSinceLastUpdate: Math.round(minutesAgo),
      batteryLevel: latest.batteryLevel,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
