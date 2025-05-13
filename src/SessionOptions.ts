import type { CookieOptions } from "hono/utils/cookie";
import CookieStore from "./store/CookieStore";
import Store from "./store/Store";

export default interface SessionOptions {
  /**
   * Session store to use. Can be a custom store or one of the built-in stores.
   * @default CookieStore
   */
  store?: Store | CookieStore;

  /**
   * Encryption key for the session data. Required if using CookieStore.
   * @default null
   */
  encryptionKey?: string;

  /**
   * Expiration time for the session in seconds. Default is 3600 seconds (1 hour).
   * @default null
   */
  expireAfterSeconds?: number;

  /**
   * Session cookie options.
   * @default { httpOnly: true, sameSite: "lax" }
   */
  cookieOptions?: CookieOptions;

  /**
   * Name of the session cookie.
   * @default "session"
   */
  sessionCookieName?: string;

  /**
   * Whether to auto-extend the session expiration on each request.
   * @default false
   */
  autoExtendExpiration?: boolean;
}
