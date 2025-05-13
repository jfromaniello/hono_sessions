import { Context } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { asyncLocalStore } from "../../src/ContextStore";
import { SessionData } from "../../src/Session";
import {
  CloudflareKVStore,
  KVNamespace,
} from "../../src/store/CloudflareKVStore";

// Create a mock for KVNamespace
const createMockKV = (): KVNamespace => ({
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
});

describe("CloudflareKVStore", () => {
  let kvStore: CloudflareKVStore;
  const mockKV: KVNamespace = createMockKV();
  // @ts-ignore
  const mockContext: Context = {
    env: {
      MY_KV: mockKV,
    },
  };

  beforeEach(() => {
    // Reset mocks
    vi.resetAllMocks();
    asyncLocalStore.enterWith(mockContext);
    // Initialize KV store with default options
    kvStore = new CloudflareKVStore({
      kv: "MY_KV",
    });
  });

  describe("constructor", () => {
    it("should initialize with default values when no optional params provided", () => {
      expect(kvStore["kvName"]).toBe("MY_KV");
      expect(kvStore["expirationTtl"]).toBe(86400); // 24 hours default
      expect(kvStore["prefix"]).toBe("session:");
    });

    it("should initialize with custom values when provided", () => {
      const customStore = new CloudflareKVStore({
        kv: "mockKV",
        expirationTtl: 3600, // 1 hour
        prefix: "custom:",
      });

      expect(customStore["kvName"]).toBe("mockKV");
      expect(customStore["expirationTtl"]).toBe(3600);
      expect(customStore["prefix"]).toBe("custom:");
    });
  });

  describe("getSessionById", () => {
    it("should return undefined if no sessionId provided", async () => {
      const result = await kvStore.getSessionById(undefined);
      expect(result).toBeUndefined();
      expect(mockKV.get).not.toHaveBeenCalled();
    });

    it("should return null if session is not found in KV", async () => {
      vi.mocked(mockKV.get).mockResolvedValueOnce(null);

      const result = await kvStore.getSessionById("test-session-id");

      expect(result).toBeNull();
      expect(mockKV.get).toHaveBeenCalledWith("session:test-session-id", {
        type: "json",
      });
    });

    it("should return session data and update accessed timestamp", async () => {
      const now = new Date();
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const mockSessionData: SessionData = {
        _data: { user: { value: { id: 123 }, flash: false } },
        _accessed: "2023-01-01T00:00:00.000Z",
        _expire: null,
        _delete: false,
      };

      vi.mocked(mockKV.get).mockResolvedValueOnce(mockSessionData);

      const result = await kvStore.getSessionById("test-session-id");

      expect(result).toEqual({
        ...mockSessionData,
        _accessed: now.toISOString(),
      });

      expect(mockKV.get).toHaveBeenCalledWith("session:test-session-id", {
        type: "json",
      });

      vi.useRealTimers();
    });

    it("should delete and return null if session has _delete flag", async () => {
      const mockSessionData: SessionData = {
        _data: { user: { value: { id: 123 }, flash: false } },
        _accessed: "2023-01-01T00:00:00.000Z",
        _expire: null,
        _delete: true,
      };

      vi.mocked(mockKV.get).mockResolvedValueOnce(mockSessionData);

      const result = await kvStore.getSessionById("test-session-id");

      expect(result).toBeNull();
      expect(mockKV.get).toHaveBeenCalledWith("session:test-session-id", {
        type: "json",
      });
      expect(mockKV.delete).toHaveBeenCalledWith("session:test-session-id");
    });

    it("should return null and log error if exception occurs", async () => {
      // Spy on console.error
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      // Make the KV.get throw an error
      vi.mocked(mockKV.get).mockRejectedValueOnce(new Error("KV error"));

      const result = await kvStore.getSessionById("test-session-id");

      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error retrieving session:",
        expect.any(Error),
      );
      expect(mockKV.get).toHaveBeenCalledWith("session:test-session-id", {
        type: "json",
      });
    });
  });

  describe("createSession", () => {
    it("should throw error if sessionId is not provided", async () => {
      const sessionData: SessionData = {
        _data: {},
        _accessed: null,
        _expire: null,
        _delete: false,
      };

      await expect(kvStore.createSession("", sessionData)).rejects.toThrow(
        "Session ID is required",
      );
      expect(mockKV.put).not.toHaveBeenCalled();
    });

    it("should set _accessed if not provided", async () => {
      const now = new Date();
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const sessionData: SessionData = {
        _data: { test: { value: "value", flash: false } },
        _accessed: null,
        _expire: null,
        _delete: false,
      };

      await kvStore.createSession("test-session-id", sessionData);

      expect(mockKV.put).toHaveBeenCalledWith(
        "session:test-session-id",
        JSON.stringify({
          ...sessionData,
          _accessed: now.toISOString(),
        }),
        { expirationTtl: 86400 },
      );

      vi.useRealTimers();
    });

    it("should use custom expiration time from _expire", async () => {
      const expireDate = new Date();
      expireDate.setSeconds(expireDate.getSeconds() + 3600); // 1 hour from now

      const sessionData: SessionData = {
        _data: { test: { value: "value", flash: false } },
        _accessed: "2023-01-01T00:00:00.000Z",
        _expire: expireDate.toISOString(),
        _delete: false,
      };

      await kvStore.createSession("test-session-id", sessionData);

      // Should convert the expiration date to unix timestamp
      const expectedExpiration = Math.floor(expireDate.getTime() / 1000);

      expect(mockKV.put).toHaveBeenCalledWith(
        "session:test-session-id",
        JSON.stringify(sessionData),
        { expiration: expectedExpiration },
      );
    });

    it("should log and rethrow error if exception occurs", async () => {
      // Spy on console.error
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      // Make the KV.put throw an error
      vi.mocked(mockKV.put).mockRejectedValueOnce(new Error("KV error"));

      const sessionData: SessionData = {
        _data: {},
        _accessed: null,
        _expire: null,
        _delete: false,
      };

      await expect(
        kvStore.createSession("test-session-id", sessionData),
      ).rejects.toThrow("KV error");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error creating session:",
        expect.any(Error),
      );
    });
  });

  describe("persistSessionData", () => {
    it("should throw error if sessionId is not provided", async () => {
      const sessionData: SessionData = {
        _data: {},
        _accessed: null,
        _expire: null,
        _delete: false,
      };

      await expect(kvStore.persistSessionData("", sessionData)).rejects.toThrow(
        "Session ID is required",
      );
      expect(mockKV.put).not.toHaveBeenCalled();
    });

    it("should update _accessed timestamp", async () => {
      const now = new Date();
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const sessionData: SessionData = {
        _data: { test: { value: "value", flash: false } },
        _accessed: "2023-01-01T00:00:00.000Z",
        _expire: null,
        _delete: false,
      };

      await kvStore.persistSessionData("test-session-id", sessionData);

      expect(mockKV.put).toHaveBeenCalledWith(
        "session:test-session-id",
        JSON.stringify({
          ...sessionData,
          _accessed: now.toISOString(),
        }),
        { expirationTtl: 86400 },
      );

      vi.useRealTimers();
    });

    it("should delete session if _delete flag is true", async () => {
      const sessionData: SessionData = {
        _data: { test: { value: "value", flash: false } },
        _accessed: "2023-01-01T00:00:00.000Z",
        _expire: null,
        _delete: true,
      };

      await kvStore.persistSessionData("test-session-id", sessionData);

      expect(mockKV.delete).toHaveBeenCalledWith("session:test-session-id");
      expect(mockKV.put).not.toHaveBeenCalled();
    });

    it("should use custom expiration time from _expire", async () => {
      const expireDate = new Date();
      expireDate.setSeconds(expireDate.getSeconds() + 3600); // 1 hour from now

      const sessionData: SessionData = {
        _data: { test: { value: "value", flash: false } },
        _accessed: "2023-01-01T00:00:00.000Z",
        _expire: expireDate.toISOString(),
        _delete: false,
      };

      await kvStore.persistSessionData("test-session-id", sessionData);

      // Should convert the expiration date to unix timestamp
      const expectedExpiration = Math.floor(expireDate.getTime() / 1000);

      expect(mockKV.put).toHaveBeenCalledWith(
        "session:test-session-id",
        expect.any(String),
        { expiration: expectedExpiration },
      );
    });

    it("should log and rethrow error if exception occurs", async () => {
      // Spy on console.error
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      // Make the KV.put throw an error
      vi.mocked(mockKV.put).mockRejectedValueOnce(new Error("KV error"));

      const sessionData: SessionData = {
        _data: {},
        _accessed: "2023-01-01T00:00:00.000Z",
        _expire: null,
        _delete: false,
      };

      await expect(
        kvStore.persistSessionData("test-session-id", sessionData),
      ).rejects.toThrow("KV error");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error persisting session data:",
        expect.any(Error),
      );
    });
  });

  describe("deleteSession", () => {
    it("should throw error if sessionId is not provided", async () => {
      await expect(kvStore.deleteSession("")).rejects.toThrow(
        "Session ID is required",
      );
      expect(mockKV.delete).not.toHaveBeenCalled();
    });

    it("should delete session from KV store", async () => {
      await kvStore.deleteSession("test-session-id");
      expect(mockKV.delete).toHaveBeenCalledWith("session:test-session-id");
    });

    it("should log and rethrow error if exception occurs", async () => {
      // Spy on console.error
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      // Make the KV.delete throw an error
      vi.mocked(mockKV.delete).mockRejectedValueOnce(new Error("KV error"));

      await expect(kvStore.deleteSession("test-session-id")).rejects.toThrow(
        "KV error",
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error deleting session:",
        expect.any(Error),
      );
    });
  });

  describe("getKeyFromSessionId", () => {
    it("should generate key with default prefix", () => {
      const key = kvStore["getKeyFromSessionId"]("test-session-id");
      expect(key).toBe("session:test-session-id");
    });

    it("should generate key with custom prefix", () => {
      const customStore = new CloudflareKVStore({
        kv: "MY_KV",
        prefix: "custom:",
      });

      const key = customStore["getKeyFromSessionId"]("test-session-id");
      expect(key).toBe("custom:test-session-id");
    });
  });

  describe("integration scenarios", () => {
    it("should support full session lifecycle: create, get, modify, and delete", async () => {
      // Initial data
      const sessionData: SessionData = {
        _data: {
          user: { value: { id: 123, name: "Test User" }, flash: false },
        },
        _accessed: new Date().toISOString(),
        _expire: null,
        _delete: false,
      };

      // Create mock for the return value
      vi.mocked(mockKV.get).mockResolvedValueOnce({
        ...sessionData,
        _accessed: new Date().toISOString(),
      });

      // Step 1: Create session
      await kvStore.createSession("test-session-id", sessionData);
      expect(mockKV.put).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      // Step 2: Get session
      const retrievedSession = await kvStore.getSessionById("test-session-id");
      expect(retrievedSession).not.toBeNull();
      expect(mockKV.get).toHaveBeenCalledTimes(1);
      expect(mockKV.get).toHaveBeenCalledWith("session:test-session-id", {
        type: "json",
      });

      vi.clearAllMocks();

      // Step 3: Update session
      const updatedSessionData: SessionData = {
        ...sessionData!,
        _data: {
          ...sessionData._data,
          lastAccess: { value: new Date().toISOString(), flash: false },
        },
      };

      await kvStore.persistSessionData("test-session-id", updatedSessionData);
      expect(mockKV.put).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      // Step 4: Delete session
      await kvStore.deleteSession("test-session-id");
      expect(mockKV.delete).toHaveBeenCalledTimes(1);
      expect(mockKV.delete).toHaveBeenCalledWith("session:test-session-id");
    });
  });
});
