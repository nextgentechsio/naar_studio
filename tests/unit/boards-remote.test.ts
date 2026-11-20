import { describe, expect, it } from "vitest";
import { assertPublicUrl, isPrivateAddress } from "@/lib/boards/remote";

// Pasted web addresses may only reach the public internet

describe("isPrivateAddress", () => {
  it("flags internal, loopback, link-local and reserved addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "not-an-ip"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it("lets public addresses through", () => {
    for (const ip of ["8.8.8.8", "151.101.1.69", "172.32.0.1", "2606:4700::1111", "::ffff:8.8.8.8"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});

describe("assertPublicUrl", () => {
  it("refuses other schemes, credentials and private hosts", async () => {
    await expect(assertPublicUrl(new URL("file:///etc/passwd"))).rejects.toThrow();
    await expect(assertPublicUrl(new URL("ftp://example.com/x.png"))).rejects.toThrow();
    await expect(assertPublicUrl(new URL("https://user:pass@example.com/x.png"))).rejects.toThrow();
    await expect(assertPublicUrl(new URL("http://127.0.0.1/x.png"))).rejects.toThrow();
    await expect(assertPublicUrl(new URL("http://[::1]/x.png"))).rejects.toThrow();
    await expect(assertPublicUrl(new URL("http://localhost/x.png"))).rejects.toThrow();
  });
});
