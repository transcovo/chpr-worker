'use strict';

const _ = require('lodash');

const { createWorkers } = require('./createWorkers');
const {
  applyHandler,
  applyConfiguration,
  applyOptions
} = require('./schema/createWorker.schema');

/**
 * Formats the createWorker parameters to call createWorkers
 * @param   {function} handler The handler function
 * @param   {Object} config The configuration
 * @param   {Object} options The options
 * @returns {Object} The formatted object
 */
function formatCreateWorkersParameters(handler, config, options) {
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
  handler = applyHandler(handler);
  config = applyConfiguration(config);
  options = applyOptions(options);

  const {
    handlers,
    config: newConfig,
    options: newOptions
  } = formatCreateWorkersParameters(handler, config, options);

  return createWorkers(handlers, newConfig, newOptions);
}

module.exports = {
  createWorker
};
