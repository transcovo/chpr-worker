'use strict';

const Joi = require('joi');
const _ = require('lodash');

const DEFAULT_HEARTBEAT = 10;
const DEFAULT_TASK_TIMEOUT = 30000;
const DEFAULT_PROCESS_TIMEOUT = 3000;
const DEFAULT_PREFETCH = 100;

const configurationSchema = Joi.object({
  handlers: Joi.array().items(Joi.object().keys({
    handle: Joi.func().required(),
    validate: Joi.func().default(_.noop),
    routingKey: Joi.string().required()
  })).required(),
  workerName: Joi.string().required(),
  amqpUrl: Joi.string().required(),
  exchangeName: Joi.string().required(),
  queueName: Joi.string().required()
});

const optionsSchema = Joi.object({
  heartbeat: Joi.number().positive().default(DEFAULT_HEARTBEAT),
  taskTimeout: Joi.number().positive().default(DEFAULT_TASK_TIMEOUT),
  processExitTimeout: Joi.number().positive().default(DEFAULT_PROCESS_TIMEOUT),
  channelPrefetch: Joi.number().positive().default(DEFAULT_PREFETCH)
});

/**
 * Formats the legacy configuration input to the new one.
 * @param {Object} obj The configuration.
 * @returns {Object} The newly formatted configuration.
 */
function _formatLegacyConfiguration(obj) {
  if (_.isFunction(obj.handlers)) {
    obj.handlers = [{ handle: obj.handlers, routingKey: obj.routingKey }];
    obj = _.omit(obj, 'routingKey');
  }
  return obj;
}

/**
 * Try to validate an object against configurationSchema
 * @param {Object} obj express request
 * @returns {Object} validated object
 */
function applyConfiguration(obj) {
  obj = _formatLegacyConfiguration(obj);
  return Joi.attempt(obj, configurationSchema);
}

/**
 * Try to validate an object against optionsSchema
 * @param {Object} obj express request
 * @returns {Object} validated object
 */
function applyOptions(obj) {
  return Joi.attempt(obj, optionsSchema);
}

module.exports = {
  applyConfiguration,
  applyOptions
};
