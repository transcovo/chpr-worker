'use strict';

const co = require('co');
const logger = require('chpr-logger');

/**
 * Make a promise outside of a yieldable.
 * To avoid unhandled callbacks resulting in unacked messages piling up in amqp,
 * the returned promise will fail after a specified timeout.
 * @param {Promise|Generator|Function} yieldable a yieldable (generator or promise)
 * @param {String} name  Name for error handling
 * @param {Number} timeout Time after which the promise fails
 * @returns {Promise} the promise
 */
function promisifyWithTimeout(yieldable, name, timeout) {
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
function subscribeToConnectionEvents(connection, workerName) {
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
 * @param {Number} channelPrefetch number of message to prefetch from channel
 * @param {String} workerName the name of the worker (for logs)
 * @returns {*} -
 * @private
 */
function subscribeToChannelEvents(channel,
  { exchangeName, queueName, channelPrefetch, workerName }) {
  channel.on('error', err => {
    logger.error(
      { err, exchangeName, queueName, channelPrefetch, workerName },
      '[AMQP] channel error'
    );
  });
  channel.on('close', () => {
    logger.info(
      { exchangeName, queueName, channelPrefetch, workerName },
      '[AMQP] channel closed'
    );
  });
}

module.exports = {
  promisifyWithTimeout,
  subscribeToConnectionEvents,
  subscribeToChannelEvents
};
