'use strict';

const stakhanov = require('stakhanov');
const logger = require('chpr-logger');

/**
 * Create a worker instance based on configuration
 * @param {Array} handlers array of handlers to handle each message
 * @param {function} handlers.handle function to handle each message
 * @param {function} handlers.validate function to validate each message body
 * @param {String} handlers.routingKey name of the routing key to bind to
 * @param {Object} config configuration for the worker
 * @param {String} config.workerName name for the worker
 * @param {String} config.amqpUrl url to amqp server
 * @param {String} config.exchangeName name of the exchange to use
 * @param {String} config.queueName name of the queue to listen on
 * @param {Object} [options] additional options
 * @param {Number} [options.heartbeat] to override default heartbeat
 * @param {Number} [options.taskTimeout] to override default task timeout
 * @param {Number} [options.processExitTimeout] to override default process exit timeout
 * @param {Number} [options.channelPrefetch] to override default channel prefetch value
 * @returns {Object} a worker instance with connection, channel, and listen/close functions
 */
function createWorkers(handlers, config, options = {}) {
  const optionsWithLogger = Object.assign({}, options, { logger });
  return stakhanov.createWorkers(handlers, config, optionsWithLogger);
}

module.exports = {
  createWorkers
};
