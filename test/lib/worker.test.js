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
      const worker = workerlib.createWorker(() => {
      }, {
        workerName,
        amqpUrl,
        exchangeName,
        queueName,
        routingKey
      });
      expect(worker.listen).to.exist();
      expect(typeof(worker.listen)).to.equal('function');
      expect(worker.close).to.exist();
      expect(typeof(worker.listen)).to.equal('function');
    });
  });

  describe('#listening', () => {
    it('should log an error and throw if connection fails', function* test() {
      sandbox.stub(amqplib, 'connect').throws();
      sandbox.spy(logger, 'error');
      let error;
      let worker;
      try {
        worker = workerlib.createWorker(() => {
        }, {
          workerName,
          amqpUrl,
          exchangeName,
          queueName,
          routingKey
        });
        yield worker.listen();
      } catch (err) {
        error = err;
      }
      expect(error).to.exist();
      expect(logger.error.called).to.be.true();
      yield worker.close(false);
    });
    it('should log and discard message if invalid JSON', function* test() {
      sandbox.spy(logger, 'warn');
      const worker = workerlib.createWorker(
        function* handle() {
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
      channel.publish(exchangeName, routingKey, new Buffer('test'));
      yield cb => setTimeout(cb, 1000);
      expect(logger.warn.called).to.be.true();
      yield worker.close(false);
    });

    it('should call message validation if provided in options', function* test() {
      let validatorCalled = false;
      let workerCalled = false;
      const worker = workerlib.createWorker(
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
        },
        {
          validator: () => {
            validatorCalled = true;
            return true;
          }
        }
      );
      yield worker.listen();
      channel.publish(exchangeName, routingKey, new Buffer(JSON.stringify(messageContent2)));
      yield cb => setTimeout(cb, 1000);
      expect(validatorCalled).to.be.true();
      expect(workerCalled).to.be.true();
      yield worker.close(false);
    });

    it('should not call handler and fail if validator throws', function* test() {
      sandbox.spy(logger, 'warn');
      let validatorCalled = false;
      let workerCalled = false;
      const worker = workerlib.createWorker(
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
        },
        {
          validator: () => {
            validatorCalled = true;
            throw new Error('validator error test');
          },
          processExitTimeout: 5000
        }
      );
      yield worker.listen();
      channel.publish(exchangeName, routingKey, new Buffer(JSON.stringify(messageContent2)));
      yield cb => setTimeout(cb, 1000);
      expect(validatorCalled).to.be.true();
      expect(workerCalled).to.be.false();
      expect(logger.warn.called).to.be.true();
      yield worker.close(false);
    });

    it('should call provided handler and nack if handler throws', function* test() {
      let workerCalled = false;
      const worker = workerlib.createWorker(
        function* handle() {
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
      worker.listen();
      channel.publish(exchangeName, routingKey, new Buffer(JSON.stringify(messageContent)));
      yield cb => setTimeout(cb, 1000);
      expect(workerCalled).to.be.true();
      yield worker.close(false);
    });

    it('should call provided handler and ack if handler runs ok', function* test() {
      let workerCalled = false;
      const worker = workerlib.createWorker(
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
      yield cb => setTimeout(cb, 1000);
      expect(workerCalled).to.be.true();
      yield worker.close(false);
    });

    it('should retry to handle message once on error catched', function* test() {
      const handlerStub = sandbox.stub();
      sandbox.spy(logger, 'info');
      handlerStub.onFirstCall().throws();
      handlerStub.onSecondCall().returns(true);
      const worker = workerlib.createWorker(
        handlerStub,
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
      yield cb => setTimeout(cb, 1000);
      yield worker.close(false);
      expect(logger.info.calledWithMatch(
        { workerName }, '[worker#listen] Consumer handler failed #1')
      ).to.be.true();
    });
  });

  describe('#_promisifyWithTimeout', () => {
    it('should timeout if promise is taking too long', function* test() {
      let error;
      const neverResolved = new Promise(resolve => setTimeout(resolve, 200));
      try {
        yield workerlib._promisifyWithTimeout(neverResolved, 'test', 100);
      } catch (err) {
        error = err;
      }
      expect(error).to.exist();
      expect(error.toString()).to.equal('Error: Yieldable timeout in test');
    });
  });

  describe('#_subscribeToConnectionEvents', () => {
    it('should log if connection is blocked', function* test() {
      sandbox.spy(logger, 'info');
      workerlib._subscribeToConnectionEvents(connection, 'test');
      connection.emit('blocked');
      expect(logger.info.calledWithMatch(
        { workerName }, '[AMQP] Connection blocked')
      ).to.be.true();
    });
    it('should log if connection is closing', function* test() {
      sandbox.spy(logger, 'info');
      workerlib._subscribeToConnectionEvents(connection, 'test');
      connection.emit('close');
      expect(logger.info.calledWithMatch(
        { workerName }, '[AMQP] Connection closing, exiting')
      ).to.be.true();
    });
    it('should exit if connection is closed and forceExit is true', function* test() {
      sandbox.spy(logger, 'info');
      sandbox.stub(process, 'exit');
      workerlib._subscribeToConnectionEvents(connection, 'test');
      connection.emit('close', true);
      yield cb => setTimeout(cb, 200);
      expect(process.exit.called).to.be.true();
      expect(logger.info.calledWithMatch(
        { workerName }, '[AMQP] Connection closing, exiting')
      ).to.be.true();
    });
    it('should log if connection is in error', function* test() {
      sandbox.spy(logger, 'error');
      workerlib._subscribeToConnectionEvents(connection, 'test');
      connection.emit('error');
      expect(logger.error.calledWithMatch(
        { workerName }, '[AMQP] Connection closing because of an error')
      ).to.be.true();
    });
  });

  describe('#_subscribeToChannelEvents', () => {
    it('should log if channel is closed', function* test() {
      sandbox.spy(logger, 'info');
      workerlib._subscribeToChannelEvents(channel, {
        workerName,
        amqpUrl,
        exchangeName,
        queueName,
        routingKey
      });
      channel.emit('close');
      expect(logger.info.calledWithMatch(
        { workerName }, '[AMQP] channel closed')
      ).to.be.true();
    });
    it('should log if channel is in error', function* test() {
      sandbox.spy(logger, 'error');
      workerlib._subscribeToChannelEvents(channel, {
        workerName,
        amqpUrl,
        exchangeName,
        queueName,
        routingKey
      });
      channel.emit('error');
      expect(logger.error.calledWithMatch(
        { workerName }, '[AMQP] channel error')
      ).to.be.true();
    });
  });

  describe('forceExit parameter setting', () => {
    it('should forcefully exit process on worker close', function* test() {
      sandbox.stub(process, 'exit');
      const worker = workerlib.createWorker(() => {
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
      yield worker.close(true);
      yield cb => setTimeout(cb, 500);
      expect(process.exit.called).to.be.true();
    });
  });
});
