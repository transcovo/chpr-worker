// Type definitions for chpr-worker 3.2.0
// Project: chpr-worker
// Definitions by: Chauffeur Privé
// TypeScript Version: 3.0.1

/// <reference types="node" />


import { Handler, Config, Process, Options as BaseOptions } from "stakhanov";

type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>

declare module Worker {
    export function createWorkers(handlers: Handler[], config: Config, options?: Options): Process
}

declare namespace Worker {
    export type Options = Omit<BaseOptions, 'logger'>
}

export = Worker;
