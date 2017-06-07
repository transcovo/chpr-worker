'use strict';
'use strict';

const { expect } = require('chai');
const sinon = require('sinon');
const amqplib = require('amqplib');
const logger = require('chpr-logger');

const {
  promisifyWithTimeout,
  subscribeToConnectionEvents,
  subscribeToChannelEvents
} = require('../../lib/lib');

const amqpUrl = 'amqp://guest:guest@localhost:5672';

describe('Lib', () => {
  const workerName = 'test';
  const queueName = 'test.test_watcher';
  const exchangeName = 'testexchange';
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

  describe('#promisifyWithTimeout', () => {
    it('should timeout if promise is taking too long', function* test() {
      let error;
      const neverResolved = new Promise(() => {});
      try {
        yield promisifyWithTimeout(neverResolved, 'test', 100);
      } catch (err) {
        error = err;
      }
      expect(error).to.exist();
      expect(error.toString()).to.equal('Error: Yieldable timeout in test');
    });
  });

  describe('#subscribeToConnectionEvents', () => {
    it('should log if connection is blocked', function* test() {
      sandbox.spy(logger, 'warn');
      subscribeToConnectionEvents(connection, 'test');
      connection.emit('blocked');
      expect(logger.warn.calledWithMatch(
        { workerName }, '[AMQP] Connection blocked')
      ).to.be.true();
    });

    it('should log if connection is closing', function* test() {
      sandbox.spy(logger, 'info');
      subscribeToConnectionEvents(connection, 'test');
      connection.emit('close');
      expect(logger.info.calledWithMatch(
        { workerName }, '[AMQP] Connection closing, exiting')
      ).to.be.true();
    });

    it('should log if connection is in error', function* test() {
      sandbox.spy(logger, 'error');
      subscribeToConnectionEvents(connection, 'test');
      connection.emit('error');
      expect(logger.error.calledWithMatch(
        { workerName }, '[AMQP] Connection closing because of an error')
      ).to.be.true();
    });
  });

  describe('#subscribeToChannelEvents', () => {
    it('should log if channel is closed', function* test() {
      sandbox.spy(logger, 'info');
      subscribeToChannelEvents(channel, {
        workerName,
        amqpUrl,
        exchangeName,
        queueName
      });
      channel.emit('close');
      expect(logger.info.calledWithMatch(
        { workerName }, '[AMQP] channel closed')
      ).to.be.true();
    });

    it('should log if channel is in error', function* test() {
      sandbox.spy(logger, 'error');
      subscribeToChannelEvents(channel, {
        workerName,
        amqpUrl,
        exchangeName,
        queueName
      });
      channel.emit('error');
      expect(logger.error.calledWithMatch(
        { workerName }, '[AMQP] channel error')
      ).to.be.true();
    });
  });
});
