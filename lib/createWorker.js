'use strict';

const _ = require('lodash');
const stakhanov = require('stakhanov');
const logger = require('chpr-logger');

/**
 * Formats the createWorker parameters to call createWorkers
 * @param   {function} handler The handler function
 * @param   {Object} config The configuration
 * @param   {Object} options The options
 * @returns {Object} The formatted object
 */
function formatCreateWorkersParameters(handler, config, options) {
  return {
    handlers: [{
      handle: handler,
      validate: options.validator || _.identity,
      routingKey: config.routingKey
    }],
    config: _.omit(config, 'routingKey'),
    options: _.omit(options, 'validator')
  };
}

/**
 * Create a worker instance based on configuration
 * @param {function} handler function to handle each message
 * @param {Object} config configuration for the worker
 * @param {Object} [options] additional options
 * @returns {Object} a worker instance with connection, channel, and listen/close functions
 * @deprecated use createWorkers instead
 */
function createWorker(handler, config, options = {}) {
  const {
    handlers,
    config: newConfig,
    options: newOptions
  } = formatCreateWorkersParameters(handler, config, options);
  newOptions.logger = logger;
  return stakhanov.createWorkers(handlers, newConfig, newOptions);
}

module.exports = {
  createWorker
};
