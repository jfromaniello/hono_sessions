import { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { CookieOptions } from "hono/utils/cookie";
import { decrypt, encrypt } from "../Crypto";
import { SessionData } from "../Session";

interface CookieStoreOptions {
  encryptionKey?: string | null;
  cookieOptions?: CookieOptions;
  sessionCookieName: string;
}

function chunkStringByBytes(input: string, maxBytes: number): string[] {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;

  for (const char of input) {
    const charBytes = encoder.encode(char).length;
    if (currentBytes + charBytes > maxBytes) {
      chunks.push(current);
      current = char;
      currentBytes = charBytes;
    } else {
      current += char;
      currentBytes += charBytes;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

const getCookieName = (name: string, index: number) => {
  if (index === 0) {
    return name;
  } else {
    return `${name}_${index}`;
  }
};

/**
 * Cookie storage driver class
 */
class CookieStore {
  public encryptionKey: string | null | undefined;
  public cookieOptions: CookieOptions | undefined;
  public sessionCookieName: string;

  constructor(options?: CookieStoreOptions) {
    this.encryptionKey = options?.encryptionKey;
    this.cookieOptions = options?.cookieOptions;
    this.sessionCookieName = options?.sessionCookieName || "session";
  }

  async getSession(c: Context): Promise<SessionData | null> {
    let session_data_raw: string;
    let sessionCookie: string = "";
    const countRaw = getCookie(c, `${this.sessionCookieName}_count`);
    const cookieCount = countRaw ? parseInt(countRaw, 10) : 1;
    if (isNaN(cookieCount) || cookieCount < 1) {
      throw new Error(`Invalid session cookie count: ${countRaw}`);
    }

    for (let i = 0; i < cookieCount; i++) {
      const chunk = getCookie(c, getCookieName(this.sessionCookieName, i));
      if (!chunk) {
        break;
      }
      sessionCookie += chunk;
    }

    if (this.encryptionKey && sessionCookie) {
      // Decrypt cookie string. If decryption fails, return null
      try {
        session_data_raw = (await decrypt(
          this.encryptionKey,
          sessionCookie,
        )) as string;
      } catch {
        return null;
      }

      // Parse session object from cookie string and return result. If fails, return null
      try {
        const session_data = JSON.parse(session_data_raw) as SessionData;
        return session_data;
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }

  async createSession(c: Context, initial_data: SessionData) {
    this.persistSessionData(c, initial_data);
  }

  async deleteSession(c: Context) {
    for (let i = 0; i < 10; i++) {
      setCookie(c, getCookieName(this.sessionCookieName, i), "", {
        ...this.cookieOptions,
        maxAge: 0,
      });
    }
    setCookie(c, `${this.sessionCookieName}_count`, "", this.cookieOptions);
  }

  async persistSessionData(c: Context, session_data: SessionData) {
    const stringified_data = JSON.stringify(session_data);
    const payload = this.encryptionKey
      ? await encrypt(this.encryptionKey, stringified_data)
      : stringified_data;

    const CHUNK_SIZE = 4000;
    const splitPayload = chunkStringByBytes(payload, CHUNK_SIZE);

    // Clean old chunks (e.g. session_0..n)
    for (let i = 0; i < 10; i++) {
      setCookie(c, getCookieName(this.sessionCookieName, i), "", {
        ...this.cookieOptions,
        maxAge: 0,
      });
    }
    setCookie(c, `${this.sessionCookieName}_count`, "", this.cookieOptions);

    if (splitPayload.length === 1) {
      setCookie(c, this.sessionCookieName, splitPayload[0], this.cookieOptions);
    } else if (splitPayload.length > 10) {
      throw new Error("Session too large for cookie storage");
    } else if (splitPayload.length > 1) {
      for (let i = 0; i < splitPayload.length; i++) {
        setCookie(
          c,
          getCookieName(this.sessionCookieName, i),
          splitPayload[i],
          this.cookieOptions,
        );
      }
      setCookie(
        c,
        `${this.sessionCookieName}_count`,
        String(splitPayload.length),
        this.cookieOptions,
      );
    }
  }
}

export default CookieStore;
