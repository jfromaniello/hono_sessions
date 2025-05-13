import { AsyncLocalStorage } from "async_hooks";
import { Context, Env, Input, MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";

export const asyncLocalStore = new AsyncLocalStorage<Context>();

export const createMiddlewareWithContextStore = <
  E extends Env = any,
  P extends string = string,
  I extends Input = {},
>(
  middleware: MiddlewareHandler<E, P, I>,
) => {
  return createMiddleware<E, P, I>((c, next) => {
    return asyncLocalStore.run(c, () => {
      return middleware(c, next);
    });
  });
};
