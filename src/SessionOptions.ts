import type { CookieOptions } from "hono/utils/cookie";
import CookieStore from "./store/CookieStore";
import Store from "./store/Store";

export default interface SessionOptions {
  store: Store | CookieStore;
  encryptionKey?: string;
  expireAfterSeconds?: number;
  cookieOptions?: CookieOptions;
  sessionCookieName?: string;
  autoExtendExpiration?: boolean;
}
