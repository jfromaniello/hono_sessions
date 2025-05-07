import { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { beforeEach, describe, expect, it, Mock, vi } from "vitest";
import * as Crypto from "../../src/Crypto";
import { decrypt, encrypt } from "../../src/Crypto";
import { SessionData } from "../../src/Session";
import CookieStore from "../../src/store/CookieStore";

// Mock the encryption/decryption functions
vi.mock("../../src/Crypto", () => {
  return {
    encrypt: vi.fn(),
    decrypt: vi.fn(),
  };
});

vi.mock("hono/cookie", () => {
  return {
    getCookie: vi.fn(),
    setCookie: vi.fn(),
  };
});

// Mock getCookie and setCookie functions from Hono
const mockGetCookie = getCookie as Mock;
const mockSetCookie = setCookie as Mock;

// Mock Context
const createMockContext = () => {
  return {
    req: {},
    res: { headers: new Map() },
  } as unknown as Context;
};

describe("CookieStore", () => {
  let cookieStore: CookieStore;
  let context: Context;
  const testEncryptionKey = "test-encryption-key-with-at-least-32-chars";
  const sessionCookieName = "test-session";
  const cookieOptions = { path: "/", httpOnly: true };

  beforeEach(() => {
    // Reset mocks
    vi.resetAllMocks();

    // Initialize cookieStore with test options
    cookieStore = new CookieStore({
      encryptionKey: testEncryptionKey,
      sessionCookieName,
      cookieOptions,
    });

    (encrypt as Mock).mockImplementation((_, data) =>
      Promise.resolve(`encrypted:${data}`),
    );

    (decrypt as Mock).mockImplementation((_, data) => {
      if (data.startsWith("encrypted:")) {
        return Promise.resolve(data.substring("encrypted:".length));
      }
      throw new Error("Invalid encrypted data format");
    });

    // Initialize mock context
    context = createMockContext();
  });

  describe("constructor", () => {
    it("should initialize with default values when no options provided", () => {
      const defaultStore = new CookieStore();
      expect(defaultStore.encryptionKey).toBeUndefined();
      expect(defaultStore.cookieOptions).toBeUndefined();
      expect(defaultStore.sessionCookieName).toBe("session");
    });

    it("should initialize with provided options", () => {
      expect(cookieStore.encryptionKey).toBe(testEncryptionKey);
      expect(cookieStore.cookieOptions).toEqual(cookieOptions);
      expect(cookieStore.sessionCookieName).toBe(sessionCookieName);
    });
  });

  describe("getSession", () => {
    it("should return null if no session cookie exists", async () => {
      mockGetCookie.mockReturnValue(null);
      const result = await cookieStore.getSession(context);
      expect(result).toBeNull();
    });

    it("should decrypt and parse session data from a single cookie", async () => {
      const sessionData: SessionData = {
        _data: { user: { value: { id: 1 }, flash: false } },
        _expire: null,
        _delete: false,
        _accessed: null,
      };

      // Mock cookie count as undefined to test single cookie
      mockGetCookie.mockImplementation((_, name) => {
        if (name === `${sessionCookieName}_count`) return null;
        if (name === `${sessionCookieName}`)
          return `encrypted:${JSON.stringify(sessionData)}`;
        return null;
      });

      const result = await cookieStore.getSession(context);
      expect(result).toEqual(sessionData);
      expect(Crypto.decrypt).toHaveBeenCalledWith(
        testEncryptionKey,
        `encrypted:${JSON.stringify(sessionData)}`,
      );
    });

    it("should return null if decryption fails", async () => {
      mockGetCookie.mockImplementation((_, name) => {
        if (name === `${sessionCookieName}_0`) return "invalid-encrypted-data";
        return null;
      });

      // Make decrypt throw an error for this test
      vi.mocked(Crypto.decrypt).mockRejectedValueOnce(
        new Error("Decryption failed"),
      );

      const result = await cookieStore.getSession(context);
      expect(result).toBeNull();
    });

    it("should return null if JSON parse fails", async () => {
      mockGetCookie.mockImplementation((_, name) => {
        if (name === `${sessionCookieName}_0`) return "encrypted:invalid-json";
        return null;
      });

      // Mock decrypt to return invalid JSON
      vi.mocked(Crypto.decrypt).mockResolvedValueOnce("invalid-json");

      const result = await cookieStore.getSession(context);
      expect(result).toBeNull();
    });

    it("should handle multiple cookie chunks", async () => {
      const sessionData: SessionData = {
        _data: { user: { value: { id: 1 }, flash: false } },
        _expire: null,
        _delete: false,
        _accessed: null,
      };
      const jsonData = JSON.stringify(sessionData);

      mockGetCookie.mockImplementation((_, name) => {
        if (name === `${sessionCookieName}_count`) return "3";
        if (name === `${sessionCookieName}`) return "encrypted:part1";
        if (name === `${sessionCookieName}_1`) return "part2";
        if (name === `${sessionCookieName}_2`) return "part3";
        return null;
      });

      // Mock decrypt to handle concatenated chunks
      vi.mocked(Crypto.decrypt).mockResolvedValueOnce(jsonData);

      const result = await cookieStore.getSession(context);
      expect(result).toEqual(sessionData);
      expect(Crypto.decrypt).toHaveBeenCalledWith(
        testEncryptionKey,
        "encrypted:part1part2part3",
      );
    });

    it("should throw an error for invalid cookie count", async () => {
      mockGetCookie.mockImplementation((_, name) => {
        if (name === `${sessionCookieName}_count`) return "invalid";
        return null;
      });

      await expect(cookieStore.getSession(context)).rejects.toThrow(
        "Invalid session cookie count: invalid",
      );
    });
  });

  describe("createSession", () => {
    it("should call persistSessionData with the initial data", async () => {
      const initialData: SessionData = {
        _data: { test: { value: "value", flash: false } },
        _expire: null,
        _delete: false,
        _accessed: null,
      };

      // Spy on persistSessionData
      const persistSpy = vi.spyOn(cookieStore, "persistSessionData");

      await cookieStore.createSession(context, initialData);

      expect(persistSpy).toHaveBeenCalledWith(context, initialData);
    });
  });

  describe("deleteSession", () => {
    it("should remove all session cookies", async () => {
      await cookieStore.deleteSession(context);

      // Check that it clears multiple cookies (0-9) and the count cookie
      expect(mockSetCookie).toBeCalledTimes(11);
      for (let i = 0; i < 10; i++) {
        expect(mockSetCookie).toHaveBeenCalledWith(
          context,
          i === 0 ? sessionCookieName : `${sessionCookieName}_${i}`,
          "",
          { ...cookieOptions, maxAge: 0 },
        );
      }
      expect(mockSetCookie).toHaveBeenCalledWith(
        context,
        `${sessionCookieName}_count`,
        "",
        cookieOptions,
      );
    });
  });

  describe("persistSessionData", () => {
    it("should store session in a single cookie if data is small", async () => {
      const sessionData: SessionData = {
        _data: { user: { value: { id: 1 }, flash: false } },
        _expire: null,
        _delete: false,
        _accessed: null,
      };

      // Mock encrypt to return a small payload that fits in one cookie
      vi.mocked(Crypto.encrypt).mockResolvedValueOnce("small-encrypted-data");

      await cookieStore.persistSessionData(context, sessionData);

      // Check that it sets one session cookie and clears all others
      expect(mockSetCookie).toHaveBeenCalledWith(
        context,
        sessionCookieName,
        "small-encrypted-data",
        cookieOptions,
      );

      // Check that it cleans previous cookies
      // 11 calls total: 10 for clearing chunks 0-9, 1 for clearing count, 1 for setting the new cookie
      expect(mockSetCookie).toHaveBeenCalledTimes(12);
    });

    it("should split session data across multiple cookies if too large", async () => {
      const sessionData: SessionData = {
        _data: { user: { value: { id: 1 }, flash: false } },
        _expire: null,
        _delete: false,
        _accessed: null,
      };

      // Return a payload that would be split into multiple chunks
      const largePayload = "a".repeat(6000); // This will be split into 2 chunks
      vi.mocked(Crypto.encrypt).mockResolvedValueOnce(largePayload);

      await cookieStore.persistSessionData(context, sessionData);

      // Cleanup + count cleanup + 2 chunks + count = 12 calls
      expect(mockSetCookie).toHaveBeenCalledTimes(14);

      // Check the count cookie was set
      expect(mockSetCookie).toHaveBeenCalledWith(
        context,
        `${sessionCookieName}_count`,
        "2",
        cookieOptions,
      );
    });

    it("should throw an error if session data is too large (>10 chunks)", async () => {
      const sessionData: SessionData = {
        _data: { user: { value: { id: 1 }, flash: false } },
        _expire: null,
        _delete: false,
        _accessed: null,
      };

      // Return a very large payload that would require >10 chunks
      const veryLargePayload = Array(11).fill("a".repeat(4000)).join("");

      vi.mocked(Crypto.encrypt).mockResolvedValueOnce(veryLargePayload);

      await expect(
        cookieStore.persistSessionData(context, sessionData),
      ).rejects.toThrow("Session too large for cookie storage");
    });

    it("should not encrypt if encryptionKey is not provided", async () => {
      // Create a store without encryption key
      const unencryptedStore = new CookieStore({
        sessionCookieName,
        cookieOptions,
        encryptionKey: null,
      });

      const sessionData: SessionData = {
        _data: { user: { value: { id: 1 }, flash: false } },
        _expire: null,
        _delete: false,
        _accessed: null,
      };

      await unencryptedStore.persistSessionData(context, sessionData);

      // Check that encrypt wasn't called
      expect(Crypto.encrypt).not.toHaveBeenCalled();
    });

    it("should correctly chunk strings based on byte size", async () => {
      const sessionData: SessionData = {
        _data: { test: { value: "value", flash: false } },
        _expire: null,
        _delete: false,
        _accessed: null,
      };

      // Create a string with multi-byte characters to test chunking
      const multiByteString =
        "a".repeat(3000) + "❤️".repeat(500) + "z".repeat(1000);
      // Each heart emoji is 4 bytes in UTF-8, so this should force proper byte-based chunking

      vi.mocked(Crypto.encrypt).mockResolvedValueOnce(multiByteString);

      await cookieStore.persistSessionData(context, sessionData);

      // Count how many times setCookie was called with actual data (not cleanup)
      const dataSetCalls = mockSetCookie.mock.calls.filter(
        (call) =>
          call[0] === context &&
          call[1].startsWith(sessionCookieName) &&
          call[1] !== `${sessionCookieName}_count` &&
          call[2] !== "",
      );

      // Should be more than 1 chunk because of multi-byte characters
      expect(dataSetCalls.length).toBeGreaterThan(1);

      // Verify the count cookie was set correctly
      expect(mockSetCookie).toHaveBeenCalledWith(
        context,
        `${sessionCookieName}_count`,
        String(dataSetCalls.length),
        cookieOptions,
      );
    });
  });

  describe("getCookieName helper", () => {
    it("should return base name for index 0", () => {
      mockGetCookie.mockImplementation((_, name) => {
        if (name === `${sessionCookieName}_0`) return "some-value";
        return null;
      });

      return cookieStore.getSession(context).then(() => {
        expect(mockGetCookie).toHaveBeenCalledWith(context, sessionCookieName);
      });
    });

    it("should append index for non-zero indices", () => {
      mockGetCookie.mockImplementation((_, name) => {
        if (name === `${sessionCookieName}_count`) return "2";
        if (name === `${sessionCookieName}`) return "part1";
        if (name === `${sessionCookieName}_1`) return "part2";
        return null;
      });

      return cookieStore.getSession(context).then(() => {
        expect(mockGetCookie).toHaveBeenCalledWith(
          context,
          `${sessionCookieName}`,
        );
        expect(mockGetCookie).toHaveBeenCalledWith(
          context,
          `${sessionCookieName}_1`,
        );
      });
    });
  });

  describe("integration scenarios", () => {
    it("should support full session lifecycle: create, get, modify, and delete", async () => {
      // Initial data
      const sessionData: SessionData = {
        _data: {
          user: { value: { id: 123, name: "Test User" }, flash: false },
        },
        _expire: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
        _delete: false,
        _accessed: new Date().toISOString(),
      };

      // Mock for encryption
      vi.mocked(Crypto.encrypt).mockResolvedValue("encrypted-session-data");

      // Step 1: Create session
      await cookieStore.createSession(context, sessionData);
      expect(mockSetCookie).toHaveBeenCalledWith(
        context,
        sessionCookieName,
        "encrypted-session-data",
        cookieOptions,
      );

      vi.clearAllMocks();

      // Step 2: Get session
      mockGetCookie.mockImplementation((_, name) => {
        if (name === sessionCookieName) return "encrypted-session-data";
        return null;
      });
      vi.mocked(Crypto.decrypt).mockResolvedValueOnce(
        JSON.stringify(sessionData),
      );

      const retrievedSession = await cookieStore.getSession(context);
      expect(retrievedSession).toEqual(sessionData);

      vi.clearAllMocks();

      // Step 3: Update session
      const updatedSessionData = {
        ...sessionData,
        _data: {
          ...sessionData._data,
          lastAccess: { value: new Date().toISOString(), flash: false },
        },
      };

      await cookieStore.persistSessionData(context, updatedSessionData);
      expect(Crypto.encrypt).toHaveBeenCalled();

      vi.clearAllMocks();

      // Step 4: Delete session
      await cookieStore.deleteSession(context);
      expect(mockSetCookie).toHaveBeenCalledWith(
        context,
        sessionCookieName,
        "",
        { ...cookieOptions, maxAge: 0 },
      );
      expect(mockSetCookie).toHaveBeenCalledWith(
        context,
        `${sessionCookieName}_count`,
        "",
        cookieOptions,
      );
    });
  });
});
