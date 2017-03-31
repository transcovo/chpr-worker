# chpr-worker
[![CircleCI](https://circleci.com/gh/transcovo/chpr-worker.svg?style=shield)](https://circleci.com/gh/transcovo/chpr-worker)
[![codecov](https://codecov.io/gh/transcovo/chpr-worker/branch/master/graph/badge.svg)](https://codecov.io/gh/transcovo/chpr-worker)

chpr-worker allows you to easily create a worker that take tasts from an AMQP queue. It handles common concerns related to implementing a worker with AMQP:
- Number of tasks handled at the same time
- Timeout after which the task is considered as failed
- Handle disconnections from the AMQP server
- Validating the schema of the message specifying the task

Example:

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

