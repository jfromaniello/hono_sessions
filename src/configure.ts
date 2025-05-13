import SessionOptions from "./SessionOptions";
import { CloudflareKVStore } from "./store/CloudflareKVStore";
import CookieStore from "./store/CookieStore";
import Store from "./store/Store";

export const configure = (options: SessionOptions) => {
  let store: Store | CookieStore | undefined = options.store;

  if (!store) {
    if (
      process.env.SESSION_STORE === "cloudflare-kv" ||
      process.env.SESSION_STORE_NAMESPACE
    ) {
      store = new CloudflareKVStore({
        kv: process.env.SESSION_STORE_NAMESPACE || "Sessions",
        expirationTtl: options.expireAfterSeconds,
      });
    } else if (
      !process.env.SESSION_STORE ||
      process.env.SESSION_STORE === "cookie"
    ) {
      store = new CookieStore();
    }

    if (!store) {
      throw new Error(
        "No session store provided. Please provide a session store or set the SESSION_STORE environment variable.",
      );
    }
  }

  const cookieOptions = options.cookieOptions ?? {
    httpOnly: true,
    sameSite: "Lax",
  };

  const expireAfterSeconds =
    options.expireAfterSeconds ??
    (typeof process.env.SESSION_EXPIRE_AFTER_SECONDS !== "undefined"
      ? parseInt(process.env.SESSION_EXPIRE_AFTER_SECONDS, 10)
      : undefined);
  const sessionCookieName =
    options.sessionCookieName ?? process.env.SESSION_COOKIE_NAME ?? "session";
  const encryptionKey =
    options.encryptionKey ?? process.env.SESSION_ENCRYPTION_KEY;

  return {
    encryptionKey,
    expireAfterSeconds,
    sessionCookieName,
    store,
    cookieOptions,
  };
};
