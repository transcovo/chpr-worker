'use strict';

const _ = require('lodash');
const { expect } = require('chai');
const sinon = require('sinon');
const amqplib = require('amqplib');
const logger = require('chpr-logger');

const { createWorkers } = require('../../lib/createWorkers');
const { createWorker } = require('../../lib/createWorker');

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
    it('should return an object with connection and channel (legacy)', function* test() {
      const worker = createWorker(() => {
      }, {
        workerName,
        amqpUrl,
        exchangeName,
        queueName,
        routingKey
      });
      expect(worker).to.have.all.keys(['listen', 'close']);
      expect(worker.listen).to.be.a('function');
      expect(worker.close).to.be.a('function');
    });

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
      expect(worker).to.have.all.keys(['listen', 'close']);
      expect(worker.listen).to.be.a('function');
      expect(worker.close).to.be.a('function');
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
      yield cb => setTimeout(cb, 100);
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
      yield cb => setTimeout(cb, 100);
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
      yield cb => setTimeout(cb, 100);
      expect(validatorCalled).to.be.true();
      expect(workerCalled).to.be.false();
      expect(logger.warn.called).to.be.true();
      yield worker.close(false);
      const message = yield channel.get(queueName);
      expect(message).to.be.false();
    });

    it('should not call handler and fail if validator throws (legacy)', function* test() {
      sandbox.spy(logger, 'warn');
      let validatorCalled = false;
      let workerCalled = false;
      const worker = createWorker(function* handle() {
        workerCalled = true;
        return true;
      }, {
        workerName,
        amqpUrl,
        exchangeName,
        queueName,
        routingKey
      }, {
        validator: () => {
          validatorCalled = true;
          throw new Error('validator error test');
        },
        processExitTimeout: 5000
      });
      yield worker.listen();
      channel.publish(exchangeName, routingKey, new Buffer(JSON.stringify(messageContent2)));
      yield cb => setTimeout(cb, 100);
      expect(validatorCalled).to.be.true();
      expect(workerCalled).to.be.false();
      expect(logger.warn.called).to.be.true();
      yield worker.close(false);
      const message = yield channel.get(queueName);
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
      yield cb => setTimeout(cb, 100);
      expect(workerCalled).to.be.true();
      yield worker.close(false);
      const message = yield channel.get(queueName);
      expect(message).to.be.false();
    });

    it('should call provided handlers and ack if handlers runs ok', function* test() {
      let worker1CallParameter = false;
      let worker2CallParameter = false;
      const routingKey2 = `${routingKey}_2`;
      const worker = createWorkers(
        [{
          handle: function* handle(content) {
            worker1CallParameter = content;
            return true;
          },
          validate: _.noop,
          routingKey
        }, {
          handle: function* handle(content) {
            worker2CallParameter = content;
            return true;
          },
          validate: () => ({ validated: true }),
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
      channel.publish(exchangeName, routingKey, new Buffer(JSON.stringify(messageContent2)));
      channel.publish(exchangeName, routingKey2, new Buffer(JSON.stringify(messageContent2)));
      yield cb => setTimeout(cb, 100);
      expect(worker1CallParameter).to.deep.equal(messageContent2);
      expect(worker2CallParameter).to.deep.equal({ validated: true });
      yield worker.close(false);
      const message = yield channel.get(queueName);
      expect(message).to.be.false();
    });

    it('should call provided handler and ack if handler runs ok (legacy)', function* test() {
      let workerCalled = false;
      const worker = createWorker(
        function* handle() {
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
      yield worker.listen();
      channel.publish(exchangeName, routingKey, new Buffer(JSON.stringify(messageContent2)));
      yield cb => setTimeout(cb, 100);
      expect(workerCalled).to.be.true();
      yield worker.close(false);
      const message = yield channel.get(queueName);
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
      yield cb => setTimeout(cb, 100);
      yield worker.close(false);
      expect(logger.warn.calledWithMatch(
        { workerName },
        '[worker#listen] Message handler failed to process message #1 - retrying one time')
      ).to.be.true();
      const message = yield channel.get(queueName);
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
      yield cb => setTimeout(cb, 100);
      yield worker.close(false);
      expect(logger.warn.calledWithMatch(
        { workerName },
        '[worker#listen] Message handler failed to process message #1 - retrying one time')
      ).to.be.true();
      expect(logger.error.calledWithMatch(
        { workerName },
        '[worker#listen] Consumer handler failed to process message #2 - discard message and fail')
      ).to.be.true();
      const message = yield channel.get(queueName);
      expect(message).to.be.false();
    });
  });

  describe('forceExit parameter setting', () => {
    it('should forcefully exit process on worker close', function* test() {
      sandbox.stub(process, 'exit');
      const worker = createWorker(() => {
      }, {
        workerName,
        amqpUrl,
        exchangeName,
        queueName,
        routingKey
      }, {
        processExitTimeout: 1
      });
      yield worker.listen();
      yield worker.close();
      yield cb => setTimeout(cb, 500);
      expect(process.exit.called).to.be.true();
    });
  });
});
