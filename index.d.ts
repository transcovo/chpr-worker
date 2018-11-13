// Type definitions for chpr-worker 3.2.0
// Project: chpr-worker
// Definitions by: Chauffeur Privé
// TypeScript Version: 3.0.1

/// <reference types="node" />

import { Logger } from 'chpr-logger';

declare module Worker {
    export function createWorkers(handlers: Worker.Handler[], config: Worker.Config, options?: Worker.Options): Worker.Process
}

declare namespace Worker {
    export interface Process {
        listen: () => void;
        close: (forceExit?: Boolean) => void;
        wait: (eventName: string, timeout?: number) => Promise<void>;
        TASK_COMPLETED: string;
        TASK_RETRIED: string;
        TASK_FAILED: string;
        WORKER_CLOSED: string;
    }

    export interface Handler<TBusMessage = any, TValidatedMessage = any> {
        routingKey: string;
        validate: (message: TBusMessage) => TValidatedMessage;
        handle: (message: TValidatedMessage) => void;
    }

    export interface Config {
        workerName: string;
        amqpUrl: string;
        exchangeName: string;
        queueName: string;
    }

    export interface Options {
        heartbeat?: number;
        taskTimeout?: number;
        processExitTimeout?: number;
        channelPrefetch?: number;
        closeOnSignals?: Boolean;
        channelCloseTimeout?: number;
        logger?: Logger;
    }
}

export = Worker;
