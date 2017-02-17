'use strict';

const _ = require('lodash');
const co = require('co');
const amqplib = require('amqplib');
const logger = require('chpr-logger');
const schema = require('./schema');

const RECONNECT_TIMEOUT = 5000;
const DEFAULT_EXCHANGE_TYPE = 'topic';
let configuration = {};

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
 * @returns {{connection: Object, channel: Object, listen: function, close: function}}
 * a worker instance with connection, channel, and listen/close functions
 */
function* createWorker(handler, config, options = {}) {
  configuration = schema.apply(Object.assign({}, { handler }, config, options));
  const connection = yield _connectAmqp(configuration.amqpUrl, configuration.heartbeat);
  const channel = yield _createChannel(connection, configuration);
  return {
    connection, channel, listen: _listen, close: function* close() {
      logger.info('[worker] Shutting down');
      if (channel) channel.close();
      yield connection.close();
      setTimeout(process.exit, configuration.processExitTimeout);
    }
  };
}

/**
 * Listen to the queue and consume any matching message posted
 * @param {String} channel channel to bind on
 * @throws if validator generates an error
 * @returns {*} -
 * @private
 */
function* _listen(channel) {
  yield channel.consume(configuration.queue, co.wrap(function* _consumeMessage(message) {
    // console.log('============ message: ', message);
    const contentString = message.content.toString();
    let content;
    // parse the message content
    try {
      content = JSON.parse(contentString);
    } catch (err) {
      logger.error(
        { err, message, options: _getOptions(), workerName: configuration.workerName },
        '[worker#listen] Content is not a valid JSON'
      );
      return channel.ack(message);
    }
    // optional message validation
    if (configuration.validator) {
      try {
        configuration.validator(message);
      } catch (err) {
        logger.error(
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
      return channel.ack(message);
    } catch (err) {
      logger.error(
        { err, message, options: _getOptions(), workerName: configuration.workerName },
        '[worker#listen] Consumer handler failed'
      );
      return channel.nack(message);
    }
  }));
  logger.info(
    { options: _getOptions(), workerName: configuration.workerName },
    '[worker#listen] worker started'
  );
}

/**
 * Try to open a connection to an AMQP server
 * http://www.squaremobius.net/amqp.node/channel_api.html#connect
 * @param {String} url the url to the server (ex: 'amqp://localhost')
 * @param {Number} heartbeat the period of the connection heartbeat, in seconds
 * @param {Object} socketOptions the options that will be passed to the socket library (net or tls).
 * @returns {Object} connection object
 * @throws if connection fails
 * @private
 */
function* _connectAmqp(url, heartbeat, socketOptions = {}) {
  try {
    const urlWithParam = `${url}?heartbeat=${heartbeat}`;
    const connection = yield amqplib.connect(urlWithParam, socketOptions);
    connection.on('close', () => {
      logger.info({
        options: _getOptions(),
        workerName: configuration.workerName
      }, '[AMQP] Connection closing, reconnecting');
      // see restart logic here https://www.cloudamqp.com/docs/nodejs.html
      setTimeout(
        () => {
          return co.wrap(_connectAmqp(url, heartbeat, socketOptions));
        }, RECONNECT_TIMEOUT
      );
    });
    connection.on('error', err => {
      logger.info({
        err, options: _getOptions(),
        workerName: configuration.workerName
      }, '[AMQP] Connection closing because of an error');
    });
    connection.on('blocked', reason => {
      logger.info({
        reason, options: _getOptions(),
        workerName: configuration.workerName
      }, '[AMQP] Connection blocked');
    });
    return connection;
  } catch (err) {
    logger.error(
      {
        err,
        url,
        heartbeat,
        socketOptions,
        options: _getOptions(),
        workerName: configuration.workerName
      },
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
 * @returns {*} -
 * @private
 */
function* _createChannel(connection, { exchangeName, queueName, routingKey, channelPrefetch }) {
  const channel = yield connection.createChannel();

  channel.on('error', err => {
    logger.info(
      { err, options: _getOptions(), workerName: configuration.workerName },
      '[AMQP] channel error'
    );
  });

  channel.on('close', () => {
    logger.info('[AMQP] channel closed');
  });

  yield channel.prefetch(channelPrefetch);
  yield channel.assertExchange(exchangeName, DEFAULT_EXCHANGE_TYPE);
  yield channel.assertQueue(queueName, {});
  yield channel.bindQueue(queueName, exchangeName, routingKey);
  return channel;
}

/**
 * Make a promise outside of a generator.
 * To avoid unhandled callbacks resulting in unacked messages piling up in amqp,
 * the returned promise will fail after a specified timeout.
 * @param {Function} generator  A generator
 * @param {String} name  Name for error handling
 * @param {Number} [timeout=30000]  Time after which the promise fails
 * @returns {Promise} the promise
 */
function _promisifyWithTimeout(generator, name, timeout = 30000) {
  return new Promise((resolve, reject) => {
    co(generator).then(resolve).catch(reject);
    setTimeout(() => reject(new Error(`Generator timeout in ${name}`)), timeout);
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

module.exports = {
  createWorker
};
