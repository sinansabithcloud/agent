const Redis = require('ioredis');
const logger = require('./logger');

class CacheManager {
  constructor(url) {
    this.client = new Redis(url || process.env.REDIS_URL, {
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this.client.on('error', (err) => {
      logger.error('Redis error', { error: err.message });
    });
  }

  async connect() {
    try {
      await this.client.connect();
      logger.info('Redis connected');
    } catch (error) {
      logger.warn('Redis connection failed, cache disabled', { error: error.message });
    }
  }

  async get(key) {
    try {
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  async set(key, value, ttlSeconds = 3600) {
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      logger.warn('Cache set failed', { key, error: error.message });
    }
  }

  async del(key) {
    try {
      await this.client.del(key);
    } catch (error) {
      logger.warn('Cache delete failed', { key, error: error.message });
    }
  }

  async hset(key, field, value) {
    try {
      await this.client.hset(key, field, JSON.stringify(value));
    } catch (error) {
      logger.warn('Cache hset failed', { key, field, error: error.message });
    }
  }

  async hgetAllValues(key) {
    try {
      const all = await this.client.hgetall(key);
      if (!all) return [];
      return Object.values(all)
        .map((v) => {
          try {
            return JSON.parse(v);
          } catch {
            return null;
          }
        })
        .filter((v) => v !== null);
    } catch {
      return [];
    }
  }

  async hdel(key, fields) {
    try {
      const list = Array.isArray(fields) ? fields : [fields];
      if (list.length) await this.client.hdel(key, ...list);
    } catch (error) {
      logger.warn('Cache hdel failed', { key, error: error.message });
    }
  }

  async publish(channel, message) {
    try {
      await this.client.publish(channel, JSON.stringify(message));
    } catch (error) {
      logger.warn('Cache publish failed', { channel, error: error.message });
    }
  }

  // Returns a dedicated connection for pub/sub (ioredis requires a separate
  // connection once a client enters subscriber mode).
  createSubscriber() {
    try {
      return this.client.duplicate();
    } catch (error) {
      logger.warn('Cache subscriber creation failed', { error: error.message });
      return null;
    }
  }

  async close() {
    await this.client.quit();
  }
}

module.exports = CacheManager;
