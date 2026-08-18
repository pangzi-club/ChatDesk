import { describe, expect, it, vi } from "vitest";
import { performHttpRequest, validateHttpUrl } from "./http-bridge.js";

describe("Electron HTTP bridge", () => {
  it("allows HTTPS and loopback HTTP only", () => {
    expect(validateHttpUrl("https://example.com/api")).toBe("https://example.com/api");
    expect(validateHttpUrl("http://127.0.0.1:14317/health")).toBe("http://127.0.0.1:14317/health");
    expect(() => validateHttpUrl("http://example.com")).toThrow();
    expect(() => validateHttpUrl("file:///etc/passwd")).toThrow();
  });

  it("revalidates redirects and serializes a bounded response", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://cdn.example.com/file" } }))
      .mockResolvedValueOnce(new Response("image", { status: 200, headers: { "content-type": "image/png" } }));

    const response = await performHttpRequest(
      { url: "https://example.com/file", method: "GET", headers: [] },
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(200);
    expect(new TextDecoder().decode(Uint8Array.from(response.body))).toBe("image");
  });
});
