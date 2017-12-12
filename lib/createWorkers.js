'use strict';

const stakhanov = require('stakhanov');
const logger = require('chpr-logger');

/**
 * Create a worker instance based on configuration
 * @param {Array} handlers array of handlers to handle each message
 * @param {Object} config configuration for the worker
 * @param {Object} [options] additional options
 * @returns {Object} a worker instance (see Readme.md for method details)
 * @see https://github.com/ChauffeurPrive/stakhanov/blob/master/README.md for documentation
 */
function createWorkers(handlers, config, options = {}) {
  const optionsWithLogger = Object.assign({}, options, { logger });
  return stakhanov.createWorkers(handlers, config, optionsWithLogger);
}

module.exports = {
  createWorkers
};
