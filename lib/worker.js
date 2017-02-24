'use strict';

const _ = require('lodash');
const co = require('co');
const amqplib = require('amqplib');
const logger = require('chpr-logger');
const { applyConfiguration, applyOptions } = require('./schema');

const DEFAULT_EXCHANGE_TYPE = 'topic';

/**
 * Create a worker instance based on configuration
 * @param {function} handler function to handle each message
 * @param {Object} config configuration for the worker
 * @param {String} config.workerName name for the worker
 * @param {String} config.amqpUrl url to amqp server
 * @param {String} config.exchangeName name of the exchange to use
 * @param {String} config.queueName name of the queue to listen on
 * @param {String} config.routingKey name of the routing key to bind to
 * @param {Object} [options] additional options
 * @param {function} [options.validator] function to validate the message with
 * @param {function} [options.heartbeat] to override default heartbeat
 * @param {function} [options.taskTimeout] to override default task timeout
 * @param {function} [options.processExitTimeout] to override default process exit timeout
 * @param {function} [options.channelPrefetch] to override default channel prefetch value
 * @param {function} [options.processConcurrency] to override default concurrency value
 * @returns {Object} a worker instance with connection, channel, and listen/close functions
 */
function createWorker(handler, config, options = {}) {
  const workerConfig = applyConfiguration(Object.assign({}, { handler }, config));
  const workerOptions = applyOptions(options);
  const configuration = Object.assign({}, workerConfig, workerOptions);
  const configWithoutFuncs = _.omit(configuration, ['handler', 'validator']);
  let workerConnection;
  let workerChannel;

  return {
    listen: co.wrap(_listen),
    close: co.wrap(_close)
  };

  /**
   * Listen to the queue and consume any matching message posted
   * @throws if validator generates an error
   * @returns {*} -
   * @private
   */
  function* _listen() {
    /** @TODO add throng in here ... */
    workerConnection = yield _connectAmqp(configuration);
    workerChannel = yield _createChannel(workerConnection, configuration);
    logger.info(
      { options: configWithoutFuncs, workerName: configuration.workerName },
      '[worker#listen] worker started'
    );
    yield workerChannel.consume(configuration.queue, co.wrap(_consumeMessage));
  }

  /**
   * Close the connection
   * @param {Boolean} forceExit if true (default), will force a process exit after
   * configured timeout
   * @returns {*} -
   * @private
   */
  function* _close(forceExit = true) {
    logger.info(
      { options: configWithoutFuncs, workerName: configuration.workerName },
      '[worker#close] Shutting down'
    );
    if (workerChannel) yield workerChannel.close();
    if (workerConnection) yield workerConnection.close(forceExit);
    if (forceExit) setTimeout(process.exit, configuration.processExitTimeout);
  }

  /**
   * Consume an AMQP message
   * @param {Object} message the message from the queue
   * @returns {*} -
   * @private
   */
  function* _consumeMessage(message) {
    /** @TODO add metrics in here ... */
    const contentString = message && message.content && message.content.toString();
    logger.info({ message, content: contentString }, '[worker#listen] received message');
    const channel = _getChannel();
    let content;

    // parse the message content
    try {
      content = JSON.parse(contentString);
    } catch (err) {
      logger.warn(
        { err, message, options: configWithoutFuncs, workerName: configuration.workerName },
        '[worker#listen] Content is not a valid JSON'
      );
      return channel.ack(message);
    }
    // optional message validation
    if (configuration.validator) {
      try {
        configuration.validator(message);
      } catch (err) {
        logger.warn(
          { err, message, options: configWithoutFuncs, workerName: configuration.workerName },
          '[worker#listen] Message validation failed'
        );
        return channel.ack(message);
      }
    }
    // call configured handler
    try {
      yield _promisifyWithTimeout(
        configuration.handler(content, message.fields),
        configuration.workerName,
        configuration.taskTimeout
      );
      return channel.ack(message);
    } catch (err) {
      if (message.fields.redelivered === false) {
        logger.info(
          { err, message, options: configWithoutFuncs, workerName: configuration.workerName },
          '[worker#listen] Consumer handler failed #1'
        );
        return channel.nack(message);
      }
      logger.error(
        { err, message, options: configWithoutFuncs, workerName: configuration.workerName },
        '[worker#listen] Consumer handler failed #2'
      );
      return channel.ack(message);
    }
  }

  /**
   * Try to open a connection to an AMQP server
   * http://www.squaremobius.net/amqp.node/channel_api.html#connect
   * @param {String} amqpUrl the url to the server (ex: 'amqp://localhost')
   * @param {String} workerName the name of the worker (for logs)
   * @param {Number} heartbeat the period of the connection heartbeat, in seconds
   * @param {Object} socketOptions the options that will be passed to the socket
   * library (net or tls).
   * @returns {Object} connection object
   * @throws if connection fails
   * @private
   */
  function* _connectAmqp({ amqpUrl, workerName, heartbeat }, socketOptions = {}) {
    try {
      const urlWithParam = `${amqpUrl}?heartbeat=${heartbeat}`;
      const connection = yield amqplib.connect(urlWithParam, socketOptions);
      logger.info({ amqpUrl, workerName, heartbeat }, '[AMQP] connect to server');
      _subscribeToConnectionEvents(connection, workerName);
      return connection;
    } catch (err) {
      logger.error(
        { err, amqpUrl, heartbeat, socketOptions, workerName },
        '[worker#_connectAmqp] connection failed'
      );
      throw err;
    }
  }

  /**
   * Create a channel for the worker
   * @param {Object} connection the connection object
   * @param {String} exchangeName the exchange name to use
   * @param {String} queueName the queue name to target
   * @param {String} routingKey routing key to bind on
   * @param {Number} channelPrefetch number of message to prefetch from channel
   * @param {String} workerName the name of the worker (for logs)
   * @returns {*} -
   * @private
   */
  function* _createChannel(connection,
    { exchangeName, queueName, routingKey, channelPrefetch, workerName }) {
    const channel = yield connection.createChannel();
    logger.info(
      { exchangeName, queueName, routingKey, channelPrefetch, workerName },
      '[AMQP] create channel'
    );
    _subscribeToChannelEvents(
      channel,
      { exchangeName, queueName, routingKey, channelPrefetch, workerName }
    );
    yield channel.prefetch(channelPrefetch);
    yield channel.assertExchange(exchangeName, DEFAULT_EXCHANGE_TYPE);
    yield channel.assertQueue(queueName, {});
    yield channel.bindQueue(queueName, exchangeName, routingKey);
    return channel;
  }

  /**
   * Get current active channel
   * @returns {Object} the channel
   * @private
   */
  function _getChannel() {
    return workerChannel;
  }
}

/**
 * Make a promise outside of a yieldable.
 * To avoid unhandled callbacks resulting in unacked messages piling up in amqp,
 * the returned promise will fail after a specified timeout.
 * @param {Promise|Generator|Function} yieldable a yieldable (generator or promise)
 * @param {String} name  Name for error handling
 * @param {Number} [timeout=30000]  Time after which the promise fails
 * @returns {Promise} the promise
 */
function _promisifyWithTimeout(yieldable, name, timeout) {
  return new Promise((resolve, reject) => {
    co(yieldable).then(resolve).catch(reject);
    setTimeout(() => reject(new Error(`Yieldable timeout in ${name}`)), timeout);
  });
}

/**
 * Bind a logger to noticeable connection events
 * @param {Object} connection the connection objext
 * @param {String} workerName worker name
 * @returns {*} -
 * @private
 */
function _subscribeToConnectionEvents(connection, workerName) {
  connection.on('close', forceExit => {
    logger.info({ workerName }, '[AMQP] Connection closing, exiting');
    if (forceExit) process.exit(1);
  });
  connection.on('error', err => {
    logger.error({ err, workerName }, '[AMQP] Connection closing because of an error');
  });
  connection.on('blocked', reason => {
    logger.info({ reason, workerName }, '[AMQP] Connection blocked');
  });
}

/**
 * Bind a logger to noticeable channel events
 * @param {Object} channel the channel object
 * @param {String} exchangeName the exchange name to use
 * @param {String} queueName the queue name to target
 * @param {String} routingKey routing key to bind on
 * @param {Number} channelPrefetch number of message to prefetch from channel
 * @param {String} workerName the name of the worker (for logs)
 * @returns {*} -
 * @private
 */
function _subscribeToChannelEvents(channel,
  { exchangeName, queueName, routingKey, channelPrefetch, workerName }) {
  channel.on('error', err => {
    logger.error(
      { err, exchangeName, queueName, routingKey, channelPrefetch, workerName },
      '[AMQP] channel error'
    );
  });
  channel.on('close', () => {
    logger.info(
      { exchangeName, queueName, routingKey, channelPrefetch, workerName },
      '[AMQP] channel closed'
    );
  });
}

module.exports = {
  createWorker,
  _subscribeToConnectionEvents,
  _subscribeToChannelEvents,
  _promisifyWithTimeout
};
