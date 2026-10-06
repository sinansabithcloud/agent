const WebSocket = require('ws');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const GpsPosition = require('../models/gps-position.model');
const geolib = require('geolib');
const { logger } = require('../shared');

class WebSocketServer {
  constructor(server, cache, eventBus) {
    this.cache = cache;
    this.eventBus = eventBus;
    this.clients = new Map(); // truckId -> ws
    this.truckSubscribers = new Map(); // truckId -> Set<ws> (fast broadcast index)
    this.instanceId = crypto.randomUUID(); // identifies this replica in Redis fan-out
    this.fanoutChannel = 'gps:broadcast';

    this.wss = new WebSocket.Server({
      server,
      path: '/gps/ws',
      verifyClient: (info, done) => {
        try {
          const url = new URL(info.req.url, `http://${info.req.headers.host}`);
          const token = url.searchParams.get('token');
          if (!token) {
            done(false, 401, 'Authentication required');
            return;
          }
          const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
          info.req.user = decoded;
          done(true);
        } catch {
          done(false, 401, 'Invalid token');
        }
      },
    });

    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));
    this.setupRedisFanout();
    logger.info('WebSocket server initialized for GPS tracking');
  }

  // Relay every local broadcast through Redis pub/sub so a dispatcher connected
  // to one replica still receives updates from a truck streaming to another
  // replica. Degrades gracefully to local-only broadcast when Redis is down.
  setupRedisFanout() {
    try {
      if (!this.cache || typeof this.cache.createSubscriber !== 'function') return;
      this.subscriber = this.cache.createSubscriber();
      if (!this.subscriber) return;

      this.subscriber.on('error', (err) =>
        logger.warn('GPS fan-out subscriber error', { error: err.message }),
      );
      this.subscriber.subscribe(this.fanoutChannel).catch((err) =>
        logger.warn('GPS fan-out subscribe failed', { error: err.message }),
      );
      this.subscriber.on('message', (channel, payload) => {
        if (channel !== this.fanoutChannel) return;
        try {
          const parsed = JSON.parse(payload);
          if (!parsed || parsed.origin === this.instanceId) return; // skip our own
          this.localBroadcast(parsed.truckId, parsed.data);
        } catch {
          /* ignore malformed fan-out payloads */
        }
      });
      logger.info('GPS Redis fan-out enabled', { channel: this.fanoutChannel });
    } catch (error) {
      logger.warn('GPS Redis fan-out disabled, using local broadcast only', {
        error: error.message,
      });
    }
  }

  handleConnection(ws, req) {
    const user = req.user;
    logger.info('GPS WebSocket connected', { userId: user.id, role: user.role });

    ws.isAlive = true;
    ws.userId = user.id;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        await this.handleMessage(ws, user, message);
      } catch (error) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      }
    });

    ws.on('close', () => {
      // Remove from tracking
      for (const [truckId, client] of this.clients) {
        if (client === ws) {
          this.clients.delete(truckId);
          logger.info('Truck GPS disconnected', { truckId });
        }
      }
      // Remove from the broadcast subscriber index
      if (ws.subscribedTrucks) {
        for (const id of ws.subscribedTrucks) {
          const subscribers = this.truckSubscribers.get(id);
          if (subscribers) {
            subscribers.delete(ws);
            if (subscribers.size === 0) this.truckSubscribers.delete(id);
          }
        }
      }
    });

    // Heartbeat
    const interval = setInterval(() => {
      if (!ws.isAlive) {
        clearInterval(interval);
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      ws.ping();
    }, 30000);

    ws.on('close', () => clearInterval(interval));
  }

  async handleMessage(ws, user, message) {
    switch (message.type) {
      case 'position_update':
        await this.handlePositionUpdate(ws, user, message);
        break;

      case 'offline_sync':
        await this.handleOfflineSync(ws, user, message);
        break;

      case 'subscribe_truck':
        this.handleSubscribe(ws, message);
        break;

      default:
        ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${message.type}` }));
    }
  }

  async handlePositionUpdate(ws, user, message) {
    const { truckId, position, manifestId, batteryLevel, engineStatus, fuelLevel, odometer } = message;

    const gpsData = {
      truckId,
      driverId: user.id,
      manifestId,
      position,
      connectivity: 'online',
      isOfflineSync: false,
      recordedAt: new Date(message.timestamp || Date.now()),
      batteryLevel,
      engineStatus,
      fuelLevel,
      odometer,
      eventType: message.eventType || 'periodic',
    };

    // Save to database
    await GpsPosition.create(gpsData);

    // Update Redis cache for real-time lookups
    await this.cache.set(`gps:truck:${truckId}`, {
      ...position,
      timestamp: gpsData.recordedAt,
      driverId: user.id,
      connectivity: 'online',
    }, 300);

    // Update the fleet snapshot hash so /gps/fleet/active can be served from
    // Redis instead of a Mongo aggregation over the last 30 minutes.
    await this.setFleetEntry(gpsData);

    // Store in tracked clients
    this.clients.set(truckId, ws);

    // Broadcast to subscribed dispatchers
    this.broadcast(truckId, {
      type: 'position_update',
      truckId,
      position,
      timestamp: gpsData.recordedAt,
      connectivity: 'online',
    });

    // Publish event
    if (this.eventBus) {
      await this.eventBus.publish('tawseelq.gps', 'gps.position.update', gpsData);
    }

    ws.send(JSON.stringify({ type: 'ack', messageId: message.messageId }));
  }

  async handleOfflineSync(ws, user, message) {
    const { positions } = message;
    if (!Array.isArray(positions) || positions.length === 0) {
      ws.send(JSON.stringify({ type: 'error', message: 'No positions to sync' }));
      return;
    }

    logger.info('Processing offline GPS sync', {
      userId: user.id,
      count: positions.length,
    });

    const docs = positions.map((pos) => ({
      truckId: pos.truckId,
      driverId: user.id,
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

    await GpsPosition.insertMany(docs, { ordered: false });

    // Update cache with latest position
    const latest = docs.sort((a, b) => b.recordedAt - a.recordedAt)[0];
    if (latest) {
      await this.cache.set(`gps:truck:${latest.truckId}`, {
        ...latest.position,
        timestamp: latest.recordedAt,
        driverId: user.id,
        connectivity: 'online',
      }, 300);
    }

    // Refresh the fleet snapshot with the newest point per truck in this batch.
    for (const doc of this.latestPerTruck(docs)) {
      await this.setFleetEntry(doc);
    }

    // Publish sync event
    if (this.eventBus) {
      await this.eventBus.publish('tawseelq.gps', 'gps.offline.sync', {
        driverId: user.id,
        count: positions.length,
        truckId: positions[0]?.truckId,
      });
    }

    ws.send(
      JSON.stringify({
        type: 'offline_sync_ack',
        synced: positions.length,
        message: `${positions.length} offline positions synced successfully`,
      }),
    );
  }

  handleSubscribe(ws, message) {
    ws.subscribedTrucks = ws.subscribedTrucks || new Set();
    const addTruck = (id) => {
      ws.subscribedTrucks.add(id);
      let subscribers = this.truckSubscribers.get(id);
      if (!subscribers) {
        subscribers = new Set();
        this.truckSubscribers.set(id, subscribers);
      }
      subscribers.add(ws);
    };
    if (message.truckId) {
      addTruck(message.truckId);
    }
    if (Array.isArray(message.truckIds)) {
      message.truckIds.forEach(addTruck);
    }
    ws.send(JSON.stringify({ type: 'subscribed', truckIds: [...ws.subscribedTrucks] }));
  }

  broadcast(truckId, data) {
    // Deliver to locally-connected subscribers...
    this.localBroadcast(truckId, data);
    // ...and relay to other replicas via Redis so their subscribers get it too.
    if (this.cache && typeof this.cache.publish === 'function') {
      this.cache.publish(this.fanoutChannel, {
        origin: this.instanceId,
        truckId,
        data,
      });
    }
  }

  localBroadcast(truckId, data) {
    const subscribers = this.truckSubscribers.get(truckId);
    if (!subscribers || subscribers.size === 0) return;
    const message = JSON.stringify(data);
    for (const client of subscribers) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  // Returns an iterator of the newest document per truckId from a batch.
  latestPerTruck(docs) {
    const byTruck = new Map();
    for (const doc of docs) {
      const current = byTruck.get(doc.truckId);
      if (!current || new Date(doc.recordedAt) > new Date(current.recordedAt)) {
        byTruck.set(doc.truckId, doc);
      }
    }
    return byTruck.values();
  }

  // Writes a truck's latest position into the Redis fleet snapshot hash. The
  // stored shape mirrors the /gps/fleet/active aggregation output exactly.
  async setFleetEntry(doc) {
    if (!this.cache || typeof this.cache.hset !== 'function') return;
    await this.cache.hset('gps:fleet', doc.truckId, {
      _id: doc.truckId,
      position: doc.position,
      recordedAt: doc.recordedAt,
      connectivity: doc.connectivity,
      driverId: doc.driverId,
      manifestId: doc.manifestId,
      engineStatus: doc.engineStatus,
      speed: doc.position?.speed,
    });
  }
}

module.exports = WebSocketServer;