'use strict';

const Joi = require('joi');
const _ = require('lodash');

const { baseConfigurationSchema, baseOptionsSchema, handlerSchema } = require('./common.schema');

const configurationSchema = baseConfigurationSchema.keys({
  routingKey: Joi.string().required()
});

const optionsSchema = baseOptionsSchema.keys({
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

/**
 * Try to validate a handler function
 * @param {function} handler The handler function
 * @returns {function} The validated handler function
 */
function applyHandler(handler) {
  return Joi.attempt(handler, handlerSchema);
}

module.exports = {
  applyConfiguration,
  applyOptions,
  applyHandler
};
