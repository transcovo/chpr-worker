# cp-amqp-worker

[![CircleCI](https://circleci.com/gh/transcovo/cp-amqp-worker.svg?style=svg&circle-token=ad4d2569df66189b49c841eb8177570d6aeec73f)](https://circleci.com/gh/transcovo/cp-amqp-worker)
[![Coverage Status](https://coveralls.io/repos/github/transcovo/cp-amqp-worker/badge.svg?t=pv91nK)](https://coveralls.io/github/transcovo/cp-amqp-worker)

### Initialization
```javascript
    function* handle(msg) { ... };
    function* validate(msg) { ... };
    
    const worker = workerlib.createWorker(
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
            channelPrefetch: 50,
            taskTimeout: 30000,
            processExitTimeout: 3000
        }
    );
```
### Basic use

To listen on channel:
```javascript
    yield worker.listen();
```
To shutdown worker:
```javascript
    yield worker.close();
```
### Dev Requirements

Install Node 6.

For nvm users, just move to the project directory and run :

    nvm i

If you already have installed Node 6 before, just type:

    nvm use

