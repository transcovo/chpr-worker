// Type definitions for chpr-worker 3.2.1
// Project: chpr-worker
// Definitions by: Chauffeur Privé
// TypeScript Version: 3.0.1

/// <reference types="node" />


import Stakhanov = require('stakhanov');

type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>

declare module Worker {
    export function createWorkers(handlers: Handler[], config: Config, options?: Options): Process
}

declare namespace Worker {
    export type Process = Stakhanov.Process
    export type Handler = Stakhanov.Handler
    export type Config = Stakhanov.Config
    export type Options = Omit<Stakhanov.Options, 'logger'>
}

export = Worker;
