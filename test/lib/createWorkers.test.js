'use strict';

const _ = require('lodash');
const { expect } = require('chai');
const sinon = require('sinon');
const amqplib = require('amqplib');
const logger = require('chpr-logger');

const { createWorkers } = require('../../lib/createWorkers');

const amqpUrl = 'amqp://guest:guest@localhost:5672';

describe('Worker library', () => {
  const workerName = 'test';
  const queueName = 'test.test_watcher';
  const exchangeName = 'testexchange';
  const routingKey = 'test.something_happened';
  const formattedQueueName = `${queueName}.${routingKey}`;
  const messageContent = { test: 'message' };
  const messageContent2 = { test: 'message2' };
  const sandbox = sinon.sandbox.create();
  let connection;
  let channel;

  before(function* before() {
    connection = yield amqplib.connect(amqpUrl);
    channel = yield connection.createChannel();
    yield channel.deleteQueue(formattedQueueName);
  });

  beforeEach(function* beforeEach() {
    yield channel.assertExchange(exchangeName, 'topic');
  });

  afterEach(() => {
    sandbox.restore();
  });

  after(function* after() {
    yield channel.deleteQueue(formattedQueueName);
    yield channel.deleteExchange(exchangeName);
    yield connection.close();
  });

  describe('#createWorkers', () => {
    it('should return an object with connection and channel', function* test() {
      const worker = createWorkers([{
        handle: () => {},
        validate: _.identity,
        routingKey
      }], {
        workerName,
        amqpUrl,
        exchangeName,
        queueName
      });
      expect(worker).to.have.all.keys([
        'listen',
        'close',
        'wait',
        'TASK_COMPLETED',
        'TASK_FAILED',
        'TASK_RETRIED',
        'WORKER_CLOSED'
      ]);
      expect(worker.listen).to.be.a('function');
      expect(worker.close).to.be.a('function');
      expect(worker.wait).to.be.a('function');
    });
  });

  describe('#wait', () => {
    it('should throw an error after the specified timeout', function* test() {
      const worker = createWorkers([{
        handle: () => true,
        validate: _.identity,
        routingKey
      }], {
        workerName,
        amqpUrl,
        exchangeName,
        queueName
      });
      let err = null;
      try {
        yield worker.wait('kk', 10);
      } catch (e) {
        err = e;
      }
      expect(err).to.exist();
      expect(err.toString()).to.equal('Error: event kk didn\'t occur after 10ms');
      yield worker.close(false);
    });

    it('should not resolve the promise when the event occurs after the timeout', function* test() {
      const worker = createWorkers(
        [{
          handle: function* handle() {
            return true;
          },
          validate: _.identity,
          routingKey
        }],
        {
          workerName,
          amqpUrl,
          exchangeName,
          queueName
        }
      );
      yield worker.listen();

      // store the promise for later to check that it's not
      // modified on the event completion
      const promise = worker.wait('task.completed', 0);

      let err = null;
      try {
        yield promise;
      } catch (e) {
        err = e;
      }
      expect(err).to.exist();

      channel.publish(exchangeName, routingKey, new Buffer(JSON.stringify(messageContent2)));
      yield worker.wait('task.completed');

      // check that the previously generated promise wasn't affected by the completion of the event
      // after the timeout
      err = null;
      try {
        yield promise;
      } catch (e) {
        err = e;
      }
      expect(err).to.exist();
      expect(err.toString()).to.equal('Error: event task.completed didn\'t occur after 0ms');
      yield worker.close(false);
    });
  });

  describe('#listening', () => {
    it('should log an error and throw if connection fails', function* test() {
      sandbox.stub(amqplib, 'connect').throws();
      sandbox.spy(logger, 'error');
      let error;
      let worker;
      try {
        worker = createWorkers([{
          handle: () => true,
          validate: _.identity,
          routingKey
        }], {
          workerName,
          amqpUrl,
          exchangeName,
          queueName
        });
        yield worker.listen();
      } catch (err) {
        error = err;
      }
      expect(error).to.exist();
      expect(logger.error).to.have.callCount(1);
      yield worker.close(false);
    });

    it('should log and discard message if invalid JSON', function* test() {
      sandbox.spy(logger, 'warn');
      const worker = createWorkers([{
        handle: () => true,
        validate: _.identity,
        routingKey
      }], {
        workerName,
        amqpUrl,
        exchangeName,
        queueName
      });
      yield worker.listen();
      channel.publish(exchangeName, routingKey, new Buffer('test'));
      yield worker.wait('task.failed');
      expect(logger.warn).to.have.callCount(1);
      yield worker.close(false);
    });

    it('should call message validation if provided', function* test() {
      let validatorCalled = false;
      let workerCalled = false;
      const worker = createWorkers([{
        handle: function* handle() {
          workerCalled = true;
          return true;
        },
        validate: () => {
          validatorCalled = true;
          return true;
        },
        routingKey
      }], {
        workerName,
        amqpUrl,
        exchangeName,
        queueName
      }, {});
      yield worker.listen();
      channel.publish(exchangeName, routingKey, new Buffer(JSON.stringify(messageContent)));
      yield worker.wait('task.completed');
      expect(validatorCalled).to.be.true();
      expect(workerCalled).to.be.true();
      yield worker.close(false);
    });

    it('should not call handler and fail if validator throws', function* test() {
      sandbox.spy(logger, 'warn');
      let validatorCalled = false;
      let workerCalled = false;
      const worker = createWorkers([{
        handle: function* handle() {
          workerCalled = true;
          return true;
        },
        validate: () => {
          validatorCalled = true;
          throw new Error('validator error test');
        },
        routingKey
      }], {
        workerName,
        amqpUrl,
        exchangeName,
        queueName
      }, {
        processExitTimeout: 5000
      });
      yield worker.listen();
      channel.publish(exchangeName, routingKey, new Buffer(JSON.stringify(messageContent2)));
      yield worker.wait('task.failed');
      expect(validatorCalled).to.be.true();
      expect(workerCalled).to.be.false();
      expect(logger.warn.called).to.be.true();
      yield worker.close(false);
      const message = yield channel.get(formattedQueueName);
      expect(message).to.be.false();
    });

    it('should call provided handler and ack if handler runs ok', function* test() {
      let workerCalled = false;
      const worker = createWorkers(
        [{
          handle: function* handle() {
            workerCalled = true;
            return true;
          },
          validate: _.identity,
          routingKey
        }],
        {
          workerName,
          amqpUrl,
          exchangeName,
          queueName
        }
      );
      yield worker.listen();
      channel.publish(exchangeName, routingKey, new Buffer(JSON.stringify(messageContent2)));
      yield worker.wait('task.completed');
      expect(workerCalled).to.be.true();
      yield worker.close(false);
      const message = yield channel.get(formattedQueueName);
      expect(message).to.be.false();
    });

    it('should call all provided handlers and ack if handlers runs ok', function* test() {
      let worker1CallParameter = false;
      let worker2CallParameter = false;
      const routingKey2 = `${routingKey}_2`;
      const worker = createWorkers(
        [{
          handle: function* handle(content) {
            worker1CallParameter = content;
            return true;
          },
          validate: _.identity,
          routingKey
        }, {
          handle: function* handle(content) {
            worker2CallParameter = content;
            return true;
          },
          validate: _.identity,
          routingKey: routingKey2
        }],
        {
          workerName,
          amqpUrl,
          exchangeName,
          queueName
        }
      );
      yield worker.listen();
      channel.publish(exchangeName, routingKey, new Buffer(JSON.stringify(messageContent)));
      yield worker.wait('task.completed');
      channel.publish(exchangeName, routingKey2, new Buffer(JSON.stringify(messageContent2)));
      yield worker.wait('task.completed');
      expect(worker1CallParameter).to.deep.equal(messageContent);
      expect(worker2CallParameter).to.deep.equal(messageContent2);
      yield worker.close(false);
      const message = yield channel.get(formattedQueueName);
      expect(message).to.be.false();
    });

    it('should perform url resolution correctly', function* test() {
      const connectStub = sandbox.spy(amqplib, 'connect');
      const worker = createWorkers([{
        handle: () => null,
        validate: _.identity,
        routingKey
      }], {
        workerName,
        amqpUrl,
        exchangeName,
        queueName
      });
      yield worker.listen();
      yield worker.close(false);
      const url = connectStub.firstCall.args[0];
      expect(url).to.equal('amqp://guest:guest@localhost:5672?heartbeat=10');
    });

    it('should retry to handle message once on error catched', function* test() {
      const handlerStub = sandbox.stub();
      sandbox.spy(logger, 'warn');
      handlerStub.onFirstCall().throws();
      handlerStub.onSecondCall().returns(true);
      const worker = createWorkers([{
        handle: handlerStub,
        validate: _.identity,
        routingKey
      }], {
        workerName,
        amqpUrl,
        exchangeName,
        queueName
      });
      yield worker.listen();
      channel.publish(exchangeName, routingKey, new Buffer(JSON.stringify(messageContent2)));
      yield worker.wait('task.retried');
      yield worker.wait('task.completed');
      yield worker.close(false);
      expect(logger.warn.calledWithMatch(
        { workerName },
        '[worker#listen] Message handler failed to process message #1 - retrying one time')
      ).to.be.true();
      const message = yield channel.get(formattedQueueName);
      expect(message).to.be.false();
    });

    it('should fail and ack message if handler fails two times on same message', function* test() {
      const handlerStub = sandbox.stub();
      sandbox.spy(logger, 'warn');
      sandbox.spy(logger, 'error');
      handlerStub.throws();
      const worker = createWorkers([{
        handle: handlerStub,
        validate: _.identity,
        routingKey
      }], {
        workerName,
        amqpUrl,
        exchangeName,
        queueName
      });
      yield worker.listen();
      channel.publish(exchangeName, routingKey, new Buffer(JSON.stringify(messageContent2)));
      yield worker.wait('task.retried');
      yield worker.wait('task.failed');
      yield worker.close(false);
      expect(logger.warn.calledWithMatch(
        { workerName },
        '[worker#listen] Message handler failed to process message #1 - retrying one time')
      ).to.be.true();
      expect(logger.error.calledWithMatch(
        { workerName },
        '[worker#listen] Consumer handler failed to process message #2 - discard message and fail')
      ).to.be.true();
      const message = yield channel.get(formattedQueueName);
      expect(message).to.be.false();
    });
  });

  describe('forceExit parameter setting', () => {
    it('should forcefully exit process on worker close', function* test() {
      const handlerStub = sandbox.stub();
      const exitStub = sandbox.stub(process, 'exit');
      const worker = createWorkers([{
        handle: handlerStub,
        validate: _.identity,
        routingKey
      }], {
        workerName,
        amqpUrl,
        exchangeName,
        queueName
      }, {
        processExitTimeout: 1
      });
      yield worker.listen();
      yield worker.close(true);
      yield cb => setTimeout(cb, 500);
      expect(exitStub.args).to.deep.equal([[0]]);
    });
  });
});
