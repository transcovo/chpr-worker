'use strict';

const Joi = require('joi');
const _ = require('lodash');

const DEFAULT_HEARTBEAT = 10;
const DEFAULT_TASK_TIMEOUT = 30000;
const DEFAULT_PROCESS_TIMEOUT = 3000;
const DEFAULT_PREFETCH = 100;

const handlerSchema = Joi.func().required();

const configurationSchema = Joi.object({
  handlers: Joi.array().items(Joi.object().keys({
    handle: handlerSchema,
    validate: Joi.func().required(),
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

const legacyConfigurationSchema = Joi.object({
  workerName: Joi.string().required(),
  amqpUrl: Joi.string().required(),
  exchangeName: Joi.string().required(),
  queueName: Joi.string().required(),
  routingKey: Joi.string().required()
});

const legacyOptionsSchema = optionsSchema.keys({
  validator: Joi.func().default(_.noop)
});

/**
 * Try to validate an object against configurationSchema
 * @param {Object} obj express request
 * @returns {Object} validated object
 */
function applyConfiguration(obj) {
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

function applyLegacyHandler(handler) {
  return Joi.attempt(handler, handlerSchema);
}

function applyLegacyConfig(obj) {
  return Joi.attempt(obj, legacyConfigurationSchema);
}

function applyLegacyOptions(obj) {
  return Joi.attempt(obj, legacyOptionsSchema);
}

module.exports = {
  applyConfiguration,
  applyOptions,

  applyLegacyHandler,
  applyLegacyConfig,
  applyLegacyOptions
};
