# cp-amqp-worker

[![CircleCI](https://circleci.com/gh/transcovo/cp-worker.svg?style=shield)](https://circleci.com/gh/transcovo/cp-worker)

### Initialization
    function* handle(msg) { ... };
    function* validate(msg) { ... };
    
    const worker = yield workerlib.createWorker(
        handle,
        {
          workerName: 'my worker',
          amqpUrl: 'amqp://guest:guest@localhost:5672',
          exchangeName: 'bus',
          queueName: 'test.test_watcher',
          routingKey: 'test.something_happened'
        },
        {
            validator: validate,
            channelPrefetch: 50
        }
    );

### Basic use

To listen on channel:

    yield worker.listen();

To shutdown worker:

    yield worker.close();

### Dev Requirements

Install Node 6.

For nvm users, just move to the project directory and run :

    nvm i

If you already have installed Node 6 before, just type:

    nvm use

