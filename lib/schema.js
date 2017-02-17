const Joi = require('joi');

const DEFAULT_HEARTBEAT = 10;
const DEFAULT_TASK_TIMEOUT = 30000;
const DEFAULT_PROCESS_TIMEOUT = 3000;
const DEFAULT_PREFETCH = 100;
const DEFAULT_CONCURRENCY = 1;

const schema = Joi.object({
  handler: Joi.func().required(),
  workerName: Joi.string().required(),
  amqpUrl: Joi.string().required(),
  exchangeName: Joi.string().required(),
  queueName: Joi.string().required(),
  routingKey: Joi.string().required(),
  // optional
  validator: Joi.func().default(null),
  heartbeat: Joi.number().min(1).default(DEFAULT_HEARTBEAT),
  taskTimeout: Joi.number().min(1).default(DEFAULT_TASK_TIMEOUT),
  processExitTimeout: Joi.number().min(1).default(DEFAULT_PROCESS_TIMEOUT),
  channelPrefetch: Joi.number().min(1).default(DEFAULT_PREFETCH),
  processConcurrency: Joi.number().min(1).default(DEFAULT_CONCURRENCY)
});

/**
 * Try to validate an object against schema
 * @param {Object} obj express request
 * @returns {*} validated object
 */
function apply(obj) {
  return Joi.attempt(obj, schema);
}

module.exports = {
  apply
};
