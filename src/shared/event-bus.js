const amqplib = require('amqplib');
const logger = require('./logger');

class EventBus {
  constructor() {
    this.connection = null;
    this.channel = null;
    this.assertedExchanges = new Set();
  }

  async connect(url) {
    try {
      this.connection = await amqplib.connect(url || process.env.RABBITMQ_URL);
      this.channel = await this.connection.createChannel();
      this.assertedExchanges = new Set(); // fresh channel: re-assert on demand
      logger.info('EventBus connected to RabbitMQ');

      this.connection.on('error', (err) => {
        logger.error('RabbitMQ connection error', { error: err.message });
      });

      this.connection.on('close', () => {
        logger.warn('RabbitMQ connection closed, attempting reconnect...');
        setTimeout(() => this.connect(url), 5000);
      });
    } catch (error) {
      logger.error('Failed to connect to RabbitMQ', { error: error.message });
      setTimeout(() => this.connect(url), 5000);
    }
  }

  async assertExchangeOnce(exchange) {
    if (this.assertedExchanges.has(exchange)) return;
    await this.channel.assertExchange(exchange, 'topic', { durable: true });
    this.assertedExchanges.add(exchange);
  }

  async publish(exchange, routingKey, message) {
    if (!this.channel) throw new Error('EventBus not connected');
    await this.assertExchangeOnce(exchange);
    this.channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(message)), {
      persistent: true,
      timestamp: Date.now(),
    });
    logger.debug('Event published', { exchange, routingKey });
  }

  async subscribe(exchange, routingKey, queue, handler) {
    if (!this.channel) throw new Error('EventBus not connected');
    await this.assertExchangeOnce(exchange);
    const q = await this.channel.assertQueue(queue, { durable: true });
    await this.channel.bindQueue(q.queue, exchange, routingKey);
    await this.channel.prefetch(1);

    this.channel.consume(q.queue, async (msg) => {
      if (!msg) return;
      try {
        const data = JSON.parse(msg.content.toString());
        await handler(data);
        this.channel.ack(msg);
      } catch (error) {
        logger.error('Event handler error', { queue, error: error.message });
        this.channel.nack(msg, false, false);
      }
    });

    logger.info('Subscribed to events', { exchange, routingKey, queue });
  }

  async close() {
    if (this.channel) await this.channel.close();
    if (this.connection) await this.connection.close();
  }
}

module.exports = EventBus;
