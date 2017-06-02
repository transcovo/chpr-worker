'use strict';

const _ = require('lodash');
const co = require('co');
const url = require('url');
const amqplib = require('amqplib');
const logger = require('chpr-logger');
const {
  applyConfiguration,
  applyOptions,
  applyLegacyHandler,
  applyLegacyConfig,
  applyLegacyOptions
} = require('./schema');

const DEFAULT_EXCHANGE_TYPE = 'topic';

function formatLegacyParameters(handler, config, options) {
  return {
    handlers: [{ handle: handler, validate: options.validator, routingKey: config.routingKey }],
    config: _.omit(config, 'routingKey'),
    options: _.omit(options, 'validator')
  };
}

/**
 * Create a worker instance based on configuration
 * @param {function} handler function to handle each message
 * @param {Object} config configuration for the worker
 * @param {String} config.workerName name for the worker
 * @param {String} config.amqpUrl url to amqp server
 * @param {String} config.exchangeName name of the exchange to use
 * @param {String} config.queueName name of the queue to listen on
 * @param {String} [config.routingKey] name of the routing key to bind to
 * @param {Object} [options] additional options
 * @param {function} [options.validator] function to validate the message with
 * @param {Number} [options.heartbeat] to override default heartbeat
 * @param {Number} [options.taskTimeout] to override default task timeout
 * @param {Number} [options.processExitTimeout] to override default process exit timeout
 * @param {Number} [options.channelPrefetch] to override default channel prefetch value
 * @returns {Object} a worker instance with connection, channel, and listen/close functions
 * @deprecated
 */
function createWorker(handler, config, options = {}) {
  handler = applyLegacyHandler(handler);
  config = applyLegacyConfig(config);
  options = applyLegacyOptions(options);

  const {
    handlers,
    config: newConfig,
    options: newOptions
  } = formatLegacyParameters(handler, config, options);

  return createWorkers(handlers, newConfig, newOptions);
}

/**
 * Create a worker instance based on configuration
 * @param {Array} handlers array of handlers to handle each message
 * @param {function} handlers.handler function to handle each message
 * @param {String} handlers.routingKey name of the routing key to bind to
 * @param {Object} config configuration for the worker
 * @param {String} config.workerName name for the worker
 * @param {String} config.amqpUrl url to amqp server
 * @param {String} config.exchangeName name of the exchange to use
 * @param {String} config.queueName name of the queue to listen on
 * @param {String} [config.routingKey] name of the routing key to bind to. Required when `handlers`
 *                                     is a function.
 * @param {Object} [options] additional options
 * @param {function} [options.validator] function to validate the message with
 * @param {Number} [options.heartbeat] to override default heartbeat
 * @param {Number} [options.taskTimeout] to override default task timeout
 * @param {Number} [options.processExitTimeout] to override default process exit timeout
 * @param {Number} [options.channelPrefetch] to override default channel prefetch value
 * @returns {Object} a worker instance with connection, channel, and listen/close functions
 */
function createWorkers(handlers, config, options = {}) {
  const workerConfig = applyConfiguration(Object.assign({}, { handlers }, config));
  const workerOptions = applyOptions(options);
  const configuration = Object.assign({}, workerConfig, workerOptions);
  const configWithoutFuncs = _.omit(configuration, ['amqpUrl', 'handlers', 'validator']);
  configWithoutFuncs.routingKeys = _.map(handlers, 'routingKey');
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
    workerConnection = yield _connectAmqp(configuration);
    workerChannel = yield _createChannel(workerConnection, configuration);
    logger.info(
      { options: configWithoutFuncs, workerName: configuration.workerName },
      '[worker#listen] worker started'
    );
    yield configuration.handlers.map(handler => _bindHandler({
      queueName: configuration.queueName,
      exchangeName: configuration.exchangeName,
      handler
    }));
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
      { options: configWithoutFuncs, workerName: configuration.workerName, forceExit },
      '[worker#close] Shutting down'
    );
    if (workerChannel) yield workerChannel.close();
    if (workerConnection) yield workerConnection.close(forceExit);
    if (forceExit) setTimeout(process.exit, configuration.processExitTimeout);
  }

  /**
   * Create an AMQP message consumer with the given handler
   *
   * @param {function} handle the message handler
   * @param {function} validate the message validator
   * @returns {function} The generator function that consumes an AMQP message
   * @private
   */
  function _getMessageConsumer(handle, validate) {
    return function* _consumeMessage(message) {
      logger.debug({ message }, '[worker#listen] received message');
      const channel = _getChannel();

      const content = _parseMessage(message);
      if (!content) return channel.ack(message);

      const validatedContent = _validateMessage(validate, content);
      if (_.isError(validatedContent)) return channel.ack(message);

      const handleSuccess = yield _handleMessage(
        handle,
        validatedContent || content,
        message.fields
      );
      if (!handleSuccess) return channel.nack(message);
      return channel.ack(message);
    };
  }

  /**
   * Parse a message and return content
   *
   * @param {Object} message the message from the queue
   * @returns {String|null} message content or null if parsing failed
   * @private
   */
  function _parseMessage(message) {
    try {
      const contentString = message && message.content && message.content.toString();
      return JSON.parse(contentString);
    } catch (err) {
      logger.warn(
        { err, message, options: configWithoutFuncs },
        '[worker#listen] Content is not a valid JSON'
      );
      return null;
    }
  }

  /**
   * Validate a message against custom validator if any
   *
   * @param {function} validate the message validator
   * @param {String} message content of the message
   * @returns {Object|null} The validated object, or null if validation failed
   * @private
   */
  function _validateMessage(validate, message) {
    const { workerName } = configuration;
    try {
      return validate(message);
    } catch (err) {
      logger.warn(
        { err, message, options: configWithoutFuncs, workerName },
        '[worker#listen] Message validation failed'
      );
      return err;
    }
  }

  /**
   * Perform message handling
   *
   * @param {function} handler message handler
   * @param {String} content message content
   * @param {Object} fields message additional fields (including 'redelivered')
   * @returns {boolean} true if message should be acked, false if it should be nacked
   * @private
   */
  function* _handleMessage(handler, content, fields) {
    const { workerName, taskTimeout } = configuration;
    try {
      yield _promisifyWithTimeout(handler(content, fields), workerName, taskTimeout);
      return true;
    } catch (err) {
      if (!fields.redelivered) {
        logger.warn(
          { err, content, options: configWithoutFuncs, workerName },
          '[worker#listen] Message handler failed to process message #1 - retrying one time'
        );
        return false;
      }
      logger.error(
        { err, content, options: configWithoutFuncs, workerName },
        '[worker#listen] Consumer handler failed to process message #2 - discard message and fail'
      );
      return true;
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
      const urlWithParam = url.resolve(amqpUrl, `?heartbeat=${heartbeat}`);
      const connection = yield amqplib.connect(urlWithParam, socketOptions);
      logger.info({ workerName, heartbeat }, '[AMQP] connected to server');
      _subscribeToConnectionEvents(connection, workerName);
      return connection;
    } catch (err) {
      logger.error(
        { err, heartbeat, socketOptions, workerName },
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
   * @returns {Object} channel object
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
    return channel;
  }

/**
 * Bind a message handler on a queue to consume
 * @param   {String} queueName the queue name
 * @param   {String} exchangeName the exchange name
 * @param   {Object} handler the handler content
 * @param   {function} handler.handler the message handler
 * @param   {String} handler.routingKey the routingKey to bind to
 * @returns {*} -
 * @private
 */
  function* _bindHandler({ queueName, exchangeName, handler: { routingKey, handle, validate } }) {
    yield workerChannel.bindQueue(queueName, exchangeName, routingKey);
    yield workerChannel.consume(queueName, co.wrap(_getMessageConsumer(handle, validate)));
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
 * @param {Number} timeout Time after which the promise fails
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
    logger.info({ workerName, forceExit }, '[AMQP] Connection closing, exiting');
  });
  connection.on('error', err => {
    logger.error({ err, workerName }, '[AMQP] Connection closing because of an error');
  });
  connection.on('blocked', reason => {
    logger.warn({ reason, workerName }, '[AMQP] Connection blocked');
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
  createWorkers,
  _subscribeToConnectionEvents,
  _subscribeToChannelEvents,
  _promisifyWithTimeout
};
