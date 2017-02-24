'use strict';

const _ = require('lodash');
const co = require('co');
const amqplib = require('amqplib');
const logger = require('chpr-logger');
const { applyConfiguration, applyOptions } = require('./schema');

const RECONNECT_TIMEOUT = 5000;
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
 * @param {Object} options additional options
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
  let connection;
  let channel;

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
    connection = yield _connectAmqp(configuration);
    channel = yield _createChannel(connection, configuration);
    console.log('===========', connection);
    console.log('===========', channel);
    yield channel.consume(configuration.queue, co.wrap(_consumeMessage));
    logger.info(
      { options: _getOptions(), workerName: configuration.workerName },
      '[worker#listen] worker started'
    );
  }

  /**
   * Close the connection
   * @returns {*} -
   * @private
   */
  function* _close() {
    logger.info('[worker] Shutting down');
    if (channel) yield channel.close();
    if (connection) yield connection.close();
    setTimeout(process.exit, configuration.processExitTimeout);
  }

  /**
   * Consume an AMQP message
   * @param {Object} message the message from the queue
   * @returns {*} -
   * @private
   */
  function* _consumeMessage(message) {
    logger.info(
      { message, content: (message && message.content && message.content.toString()) || null },
      '[worker#listen] received message'
    );
    const activeChannel = _getChannel();
    let content;
    // parse the message content
    try {
      const contentString = message.content.toString();
      content = JSON.parse(contentString);
    } catch (err) {
      logger.warn(
        { err, message, options: _getOptions(), workerName: configuration.workerName },
        '[worker#listen] Content is not a valid JSON'
      );
      return activeChannel.ack(message);
    }
    // optional message validation
    if (configuration.validator) {
      try {
        configuration.validator(message);
      } catch (err) {
        logger.warn(
          { err, message, options: _getOptions(), workerName: configuration.workerName },
          '[worker#listen] Message validation failed'
        );
        throw err;
      }
    }
    // call configured handler
    try {
      yield _promisifyWithTimeout(
        configuration.handler(content, message.fields),
        configuration.workerName,
        configuration.taskTimeout
      );
      return activeChannel.ack(message);
    } catch (err) {
      logger.error(
        { err, message, options: _getOptions(), workerName: configuration.workerName },
        '[worker#listen] Consumer handler failed'
      );
      return activeChannel.nack(message);
    }
  }

  /**
   * Try to open a connection to an AMQP server
   * http://www.squaremobius.net/amqp.node/channel_api.html#connect
   * @param {String} url the url to the server (ex: 'amqp://localhost')
   * @param {String} workerName the name of the worker (for logs)
   * @param {Number} heartbeat the period of the connection heartbeat, in seconds
   * @param {Object} socketOptions the options that will be passed to the socket
   * library (net or tls).
   * @returns {Object} connection object
   * @throws if connection fails
   * @private
   */
  function* _connectAmqp({ amqpUrl: url, workerName, heartbeat }, socketOptions = {}) {
    try {
      const urlWithParam = `${url}?heartbeat=${heartbeat}`;
      const amqpConnection = yield amqplib.connect(urlWithParam, socketOptions);
      amqpConnection.on('close', () => {
        logger.info({ workerName }, '[AMQP] Connection closing, reconnecting');
        // see restart logic here https://www.cloudamqp.com/docs/nodejs.html
        setTimeout(
          () => co.wrap(_connectAmqp({ url, heartbeat, workerName }, socketOptions)),
          RECONNECT_TIMEOUT
        );
      });
      amqpConnection.on('error', err => {
        logger.info({ err, workerName }, '[AMQP] Connection closing because of an error');
      });
      amqpConnection.on('blocked', reason => {
        logger.info({ reason, workerName }, '[AMQP] Connection blocked');
      });
      return amqpConnection;
    } catch (err) {
      logger.error(
        { err, url, heartbeat, socketOptions, workerName },
        '[worker#_connectAmqp] connection failed'
      );
      throw err;
    }
  }

  /**
   * Create a channel for the worker
   * @param {Object} amqpConnection the connection object
   * @param {String} exchangeName the exchange name to use
   * @param {String} queueName the queue name to target
   * @param {String} routingKey routing key to bind on
   * @param {Number} channelPrefetch number of message to prefetch from channel
   * @param {String} workerName the name of the worker (for logs)
   * @returns {*} -
   * @private
   */
  function* _createChannel(amqpConnection,
    { exchangeName, queueName, routingKey, channelPrefetch, workerName }) {
    const amqpChannel = yield amqpConnection.createChannel();

    amqpChannel.on('error', err => {
      logger.info(
        { err, exchangeName, queueName, routingKey, channelPrefetch, workerName },
        '[AMQP] channel error'
      );
    });

    amqpChannel.on('close', () => {
      logger.info(
        { exchangeName, queueName, routingKey, channelPrefetch, workerName },
        '[AMQP] channel closed'
      );
    });

    yield amqpChannel.prefetch(channelPrefetch);
    yield amqpChannel.assertExchange(exchangeName, DEFAULT_EXCHANGE_TYPE);
    yield amqpChannel.assertQueue(queueName, {});
    yield amqpChannel.bindQueue(queueName, exchangeName, routingKey);
    return amqpChannel;
  }

  /**
   * Make a promise outside of a yieldable.
   * To avoid unhandled callbacks resulting in unacked messages piling up in amqp,
   * the returned promise will fail after a specified timeout.
   * @param {Function} yieldable a yieldable (generator or promise)
   * @param {String} name  Name for error handling
   * @param {Number} [timeout=30000]  Time after which the promise fails
   * @returns {Promise} the promise
   */
  function _promisifyWithTimeout(yieldable, name, timeout = 30000) {
    return new Promise((resolve, reject) => {
      co(yieldable).then(resolve).catch(reject);
      setTimeout(() => reject(new Error(`Yieldable timeout in ${name}`)), timeout);
    });
  }

  /**
   * Get the configuration values except functions (handler, validator)
   * @returns {Object} configuration
   * @private
   */
  function _getOptions() {
    return _.omit(configuration, ['handler', 'validator']);
  }

  /**
   * Get current active channel
   * @returns {Object} the channel
   * @private
   */
  function _getChannel() {
    return channel;
  }
}

module.exports = {
  createWorker
};
