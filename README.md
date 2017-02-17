# cp-amqp-worker

[![CircleCI](https://circleci.com/gh/transcovo/cp-worker.svg?style=shield)](https://circleci.com/gh/transcovo/cp-worker)

### Requirements

Install Node 6.3.1.

For nvm users, just move to the project directory and run :

    nvm i

If you already have installed Node 6.3.1 before, just type:

    nvm use

### Initialization
    
    const worker = yield workerlib.createWorker(
        function* handle(msg) { ... },
        {
          workerName: 'my worker',
          amqpUrl: 'amqp://guest:guest@localhost:5672',
          exchangeName: 'bus',
          queueName: 'test.test_watcher',
          routingKey: 'test.something_happened'
        }
    );

### Basic use

To listen on channel:

    yield worker.listen(worker.channel);

To shutdown worker:

    yield worker.close();