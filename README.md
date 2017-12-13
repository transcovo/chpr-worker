# chpr-worker
[![CircleCI](https://circleci.com/gh/transcovo/chpr-worker.svg?style=shield)](https://circleci.com/gh/transcovo/chpr-worker)
[![codecov](https://codecov.io/gh/transcovo/chpr-worker/branch/master/graph/badge.svg)](https://codecov.io/gh/transcovo/chpr-worker)

chpr-worker allows you to easily create a worker that take tasks from an AMQP queue. It handles common concerns related to implementing a worker with AMQP:
- Number of tasks handled at the same time
- Timeout after which the task is considered as failed
- Handle disconnections from the AMQP server
- Validating the schema of the message specifying the task

**Note:** this package is a wrapper for the **[stakhanov](https://www.npmjs.com/package/stakhanov)** open-source package. It only adds our logger via 
dependency injection. For up-to-date documentation, please consult the stakhanov project's [repository](https://github.com/ChauffeurPrive/stakhanov).

**BREAKING CHANGE with version >= 2.x**

It is not possible anymore to create a single worker by calling `createWorker`:
```javascript
    const worker = workerlib.createWorker({...});
```

You should use `createWorkers` for all worker creations.

**WARNING**

The `queueName` configuration must be unique for each worker, otherwise messages won't necessarily 
be routed to the good consumer.

When listening, the lib will create a queue of the form `queueName.routingKey` for each routing 
key/handler. That is why the queueName config must really be unique, typically of the form 
`application.workername`. This will generate a unique queue name per routing key, of the form 
`application.workername.routingkey`.

Example:

```javascript
    function* handle(msg) { ... };
    function* validate(msg) { ... };

    const worker = workerlib.createWorkers([{
      handle: handle,
      validate: validate,
      routingKey: 'test.something_happened'
    }], {
      workerName: 'my worker',
      amqpUrl: 'amqp://guest:guest@localhost:5672',
      exchangeName: 'bus',
      queueName: 'test.test_watcher'
    }, {
      channelPrefetch: 50,
      taskTimeout: 30000,
      processExitTimeout: 3000,
      channelCloseTimeout: 500
    });
```
### Basic use

To listen on channel:
```javascript
    yield worker.listen();
```
To shutdown worker:
```javascript
    worker.close();
```
Remark: for testing purpose, as the close function will execute a process.exit, you can
add the following parameter to the close function:
```javascript
    worker.close(false);
```

By default, the `close` method will be called on SIGTERM/SIGINT signals and operate a graceful shutdown.
If you want to override this behaviour (not recommended for production workers),
you should specify `closeOnSignals: false` as an option.

### Events

To organize your own tests, the worker instance allows you to wait for specific event
with the `wait` method.

Example:

    yield worker.wait(worker.TASK_COMPLETED);

Spec:

    wait(event, timeout)

The wait method returns a Promise which will be completed when the expected event
occurs for the first time, or rejected after a timeout.

`event`: name of the event, required. Must be one of the available events:

- `worker.TASK_COMPLETED`: emitted when a task has been completed.
- `worker.TASK_RETRIED`: emitted when a task is going to be retried because the
 handler has failed.
- `worker.TASK_FAILED`: emitted when a task has failed because the handler
 has failed on a task which was already being retried.
- `worker.WORKER_CLOSED`: emitted when the worker has been closed.

`timeout`: timeout in milliseconds after which the promise will be rejected. Defaults
to 1000 ms.

### Dev Requirements

Install Node 6.

For nvm users, just move to the project directory and run :

    nvm i

If you already have installed Node 6 before, just type:

    nvm use
