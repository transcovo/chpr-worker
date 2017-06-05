'use strict';

const Joi = require('joi');

const DEFAULT_HEARTBEAT = 10;
const DEFAULT_TASK_TIMEOUT = 30000;
const DEFAULT_PROCESS_TIMEOUT = 3000;
const DEFAULT_PREFETCH = 100;

const handlerSchema = Joi.func().required();

const baseConfigurationSchema = Joi.object({
  workerName: Joi.string().required(),
  amqpUrl: Joi.string().required(),
  exchangeName: Joi.string().required(),
  queueName: Joi.string().required()
});

const baseOptionsSchema = Joi.object({
  heartbeat: Joi.number().positive().default(DEFAULT_HEARTBEAT),
  taskTimeout: Joi.number().positive().default(DEFAULT_TASK_TIMEOUT),
  processExitTimeout: Joi.number().positive().default(DEFAULT_PROCESS_TIMEOUT),
  channelPrefetch: Joi.number().positive().default(DEFAULT_PREFETCH)
});

module.exports = {
  handlerSchema,
  baseConfigurationSchema,
  baseOptionsSchema
};
