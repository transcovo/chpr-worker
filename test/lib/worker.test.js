'use strict';

const { expect } = require('chai');
const sinon = require('sinon');
const amqplib = require('amqplib');
const workerlib = require('../../lib/worker');

const logger = require('chpr-logger');
const amqpUrl = 'amqp://guest:guest@localhost:5672';

describe('Worker library', () => {
  const workerName = 'test';
  const queueName = 'test.test_watcher';
  const exchangeName = 'testexchange';
  const routingKey = 'test.something_happened';
  const messageContent = { test: 'message' };
  const messageContent2 = { test: 'message2' };
  const sandbox = sinon.sandbox.create();
  let connection;
  let channel;

  before(function* before() {
    connection = yield amqplib.connect(amqpUrl);
    channel = yield connection.createChannel();
    yield channel.assertExchange(exchangeName, 'topic');
    yield channel.deleteQueue(queueName);
  });
  beforeEach(function* beforeEach() {
    yield channel.assertExchange(exchangeName, 'topic');
  });
  afterEach(() => {
    sandbox.restore();
  });
  after(function* after() {
    yield channel.deleteQueue(queueName);
    yield channel.deleteExchange(exchangeName);
    yield connection.close();
  });

  describe('#createWorker', () => {
    it('should return an object with connection and channel', function* test() {
      const worker = yield workerlib.createWorker(() => {
      }, {
        workerName,
        amqpUrl,
        exchangeName,
        queueName,
        routingKey
      });
      expect(worker.connection).to.exist();
      expect(typeof(worker.connection)).to.equal('object');
      expect(worker.connection.connection).to.exist();
      expect(worker.channel).to.exist();
      expect(typeof(worker.channel)).to.equal('object');
      expect(typeof(worker.channel.connection)).to.exist();
      expect(worker.listen).to.exist();
      expect(typeof(worker.listen)).to.equal('function');
      expect(worker.close).to.exist();
      expect(typeof(worker.listen)).to.equal('function');
    });

    it('should log an error and throw if connection fails', function* test() {
      sandbox.stub(amqplib, 'connect').throws();
      sandbox.spy(logger, 'error');
      let error;
      try {
        yield workerlib.createWorker(() => {
        }, {
          workerName,
          amqpUrl,
          exchangeName,
          queueName,
          routingKey
        });
      } catch (err) {
        error = err;
      }
      expect(error).to.exist();
      expect(logger.error.called).to.be.true();
    });
  });

  describe('#listening', () => {
    it('should log and discard message if invalid JSON', function* test() {
      sandbox.spy(logger, 'error');
      const worker = yield workerlib.createWorker(
        function* handle(msg) {
          return true;
        },
        {
          workerName,
          amqpUrl,
          exchangeName,
          queueName,
          routingKey
        }
      );
      channel.publish(exchangeName, routingKey, new Buffer('test'));
      yield worker.listen(worker.channel);
      expect(logger.error.called).to.be.true();
      yield worker.close();
    });

    it('should call message validation if provided in options', function* test() {
      let validatorCalled = false;
      let workerCalled = false;
      const worker = yield workerlib.createWorker(
        function* handle(msg) {
          workerCalled = true;
          return true;
        },
        {
          workerName,
          amqpUrl,
          exchangeName,
          queueName,
          routingKey,
          validator: function (msg) {
            validatorCalled = true;
            return true;
          }
        }
      );
      channel.publish(exchangeName, routingKey, new Buffer(JSON.stringify(messageContent2)));
      yield worker.listen(worker.channel);
      expect(validatorCalled).to.be.true();
      expect(workerCalled).to.be.true();
      yield worker.close();
    });

    it('should not call handler and fail if validator throws', function* test() {
      sandbox.spy(logger, 'error');
      let validatorCalled = false;
      let workerCalled = false;
      const worker = yield workerlib.createWorker(
        function* handle(msg) {
          workerCalled = true;
          return true;
        },
        {
          workerName,
          amqpUrl,
          exchangeName,
          queueName,
          routingKey,
          validator: function (msg) {
            validatorCalled = true;
            throw new Error('validator error test');
          }
        }
      );
      channel.publish(exchangeName, routingKey, new Buffer(JSON.stringify(messageContent2)));
      yield worker.listen(worker.channel);
      expect(validatorCalled).to.be.true();
      expect(workerCalled).to.be.false();
      expect(logger.error.called).to.be.true();
      yield worker.close();
    });

    it('should call provided handler and nack if handler throws', function* test() {
      let workerCalled = false;
      const worker = yield workerlib.createWorker(
        function* handle(msg) {
          workerCalled = true;
          throw new Error('handler error test');
        },
        {
          workerName,
          amqpUrl,
          exchangeName,
          queueName,
          routingKey
        }
      );
      channel.publish(exchangeName, routingKey, new Buffer(JSON.stringify(messageContent)));
      yield worker.listen(worker.channel);
      expect(workerCalled).to.be.true();
      yield worker.close();
    });

    it('should call provided handler and ack if handler runs ok', function* test() {
      let workerCalled = false;
      const worker = yield workerlib.createWorker(
        function* handle(msg) {
          workerCalled = true;
          return true;
        },
        {
          workerName,
          amqpUrl,
          exchangeName,
          queueName,
          routingKey
        }
      );
      channel.publish(exchangeName, routingKey, new Buffer(JSON.stringify(messageContent2)));
      yield worker.listen(worker.channel);
      expect(workerCalled).to.be.true();
      yield worker.close();
    });
  });
});
