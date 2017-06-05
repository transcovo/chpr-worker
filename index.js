'use strict';

const { createWorkers } = require('./lib/createWorkers');
const { createWorker } = require('./lib/createWorker');

module.exports = {
  createWorker,
  createWorkers
};
