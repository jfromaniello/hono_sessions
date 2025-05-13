import { asyncLocalStore } from "../ContextStore";
import { SessionData } from "../Session";
import Store from "./Store";

export interface KVNamespace {
  get(
    key: string,
    options?: { type?: string; cacheTtl?: number },
  ): Promise<any>;
  put(
    key: string,
    value: any,
    options?: { expiration?: number; expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface CloudflareKVStoreOptions {
  /**
   * KV namespace binding to use for storage
   */
  kv: string;
  /**
   * Session expiration in seconds (default: 24 hours)
   */
  expirationTtl?: number;
  /**
   * Session prefix in KV store (default: 'session:')
   */
  prefix?: string;
}

/**
 * Session store implementation using Cloudflare Workers KV
 */
export class CloudflareKVStore implements Store {
  private kvName: string;
  private expirationTtl: number;
  private prefix: string;

  /**
   * Creates a new KV session store
   */
  constructor(options: CloudflareKVStoreOptions) {
    this.kvName = options.kv;
    this.expirationTtl = options.expirationTtl || 86400; // Default: 24 hours
    this.prefix = options.prefix || "session:";
  }

  private get kv(): KVNamespace {
    const context = asyncLocalStore.getStore();
    if (!context) {
      throw new Error("KV namespace is not available in the current context");
    }
    if (!context.env || !context.env[this.kvName]) {
      throw new Error(
        `KV namespace "${this.kvName}" is not available in the current context`,
      );
    }
    return context.env[this.kvName] as KVNamespace;
  }

  /**
   * Retrieve a session by ID
   */
  async getSessionById(
    sessionId?: string,
  ): Promise<SessionData | null | undefined> {
    if (!sessionId) {
      return undefined;
    }

    try {
      const key = this.getKeyFromSessionId(sessionId);
      const data = await this.kv.get(key, { type: "json" });

      if (!data) {
        return null;
      }

      // Update the _accessed timestamp
      const sessionData = data as SessionData;
      sessionData._accessed = new Date().toISOString();

      // If the session was marked for deletion, return null
      if (sessionData._delete) {
        await this.deleteSession(sessionId);
        return null;
      }

      return sessionData;
    } catch (error) {
      console.error("Error retrieving session:", error);
      return null;
    }
  }

  /**
   * Create a new session
   */
  async createSession(
    sessionId: string,
    initialData: SessionData,
  ): Promise<void> {
    if (!sessionId) {
      throw new Error("Session ID is required");
    }

    try {
      const key = this.getKeyFromSessionId(sessionId);
      const now = new Date();

      // Set creation timestamp if not provided
      if (!initialData._accessed) {
        initialData._accessed = now.toISOString();
      }

      // Calculate expiration if provided in _expire field
      let expiration: number | undefined;
      if (initialData._expire) {
        const expireDate = new Date(initialData._expire);
        expiration = Math.floor(expireDate.getTime() / 1000);
      }

      // Store in KV with TTL
      await this.kv.put(key, JSON.stringify(initialData), {
        expirationTtl: expiration ? undefined : this.expirationTtl,
        expiration: expiration,
      });
    } catch (error) {
      console.error("Error creating session:", error);
      throw error;
    }
  }

  /**
   * Update an existing session
   */
  async persistSessionData(
    sessionId: string,
    sessionData: SessionData,
  ): Promise<void> {
    if (!sessionId) {
      throw new Error("Session ID is required");
    }

    try {
      const key = this.getKeyFromSessionId(sessionId);
      const now = new Date();

      // Update accessed timestamp
      sessionData._accessed = now.toISOString();

      // If the session is marked for deletion, delete it
      if (sessionData._delete) {
        await this.deleteSession(sessionId);
        return;
      }

      // Calculate expiration if provided in _expire field
      let expiration: number | undefined;
      if (sessionData._expire) {
        const expireDate = new Date(sessionData._expire);
        expiration = Math.floor(expireDate.getTime() / 1000);
      }

      // Store in KV with TTL
      await this.kv.put(key, JSON.stringify(sessionData), {
        expirationTtl: expiration ? undefined : this.expirationTtl,
        expiration: expiration,
      });
    } catch (error) {
      console.error("Error persisting session data:", error);
      throw error;
    }
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    if (!sessionId) {
      throw new Error("Session ID is required");
    }

    try {
      const key = this.getKeyFromSessionId(sessionId);
      await this.kv.delete(key);
    } catch (error) {
      console.error("Error deleting session:", error);
      throw error;
    }
  }

  /**
   * Generate a KV key from a session ID
   */
  private getKeyFromSessionId(sessionId: string): string {
    return `${this.prefix}${sessionId}`;
  }
}
