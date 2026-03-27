declare module "hono" {
  export class Hono<E = any> {
    constructor(options?: any);
    use(...args: any[]): any;
    on(method: string | string[], path: string, ...handlers: any[]): any;
    get(path: string, ...handlers: any[]): any;
    post(path: string, ...handlers: any[]): any;
    put(path: string, ...handlers: any[]): any;
    patch(path: string, ...handlers: any[]): any;
    delete(path: string, ...handlers: any[]): any;
    route(path: string, app: any): any;
    onError(handler: any): any;
    notFound(handler: any): any;
    fetch(request: Request, env?: any, executionCtx?: any): Promise<Response>;
  }

  export type Context = any;
  export type MiddlewareHandler = any;
}

declare module "@neondatabase/serverless" {
  export const neonConfig: Record<string, unknown>;

  export class Pool {
    constructor(config: Record<string, unknown>);
    connect(): Promise<any>;
    end(): Promise<void>;
  }
}

declare module "stripe" {
  const Stripe: any;
  export default Stripe;
}

interface R2PutOptions {
  httpMetadata?: {
    contentType?: string;
    cacheControl?: string;
  };
}

interface R2Bucket {
  put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob, options?: R2PutOptions): Promise<void>;
}
