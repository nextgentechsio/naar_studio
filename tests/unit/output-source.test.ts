import { describe, expect, it } from "vitest";
import { isReplicateDeliveryUrl } from "@/lib/storage/output-source";

// Where Replicate outputs may be downloaded from (the
// server fetches them, so anything else is refused)

const R2 = "https://ai-gateway-outputs.0d37909e38d3e99c29fa2cd343ac421a.r2.cloudflarestorage.com/out/abc.png";
const signed = `${R2}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=3600&X-Amz-Signature=deadbeef`;

describe("Replicate output sources", () => {
  it("allows Replicate's CDN and its signed R2 links", () => {
    expect(isReplicateDeliveryUrl(new URL("https://replicate.delivery/x.png"))).toBe(true);
    expect(isReplicateDeliveryUrl(new URL("https://pbxt.replicate.delivery/x.png"))).toBe(true);
    expect(isReplicateDeliveryUrl(new URL(signed))).toBe(true);
  });

  it("refuses anything else", () => {
    // Unsigned, plain http, another bucket, a look-alike
    expect(isReplicateDeliveryUrl(new URL(R2))).toBe(false);
    expect(isReplicateDeliveryUrl(new URL(signed.replace("https:", "http:")))).toBe(false);
    expect(isReplicateDeliveryUrl(new URL(signed.replace("ai-gateway-outputs", "my-bucket")))).toBe(false);
    expect(isReplicateDeliveryUrl(new URL(signed.replace(".r2.cloudflarestorage.com", ".r2.cloudflarestorage.com.evil.io")))).toBe(false);
    expect(isReplicateDeliveryUrl(new URL("https://replicate.delivery.evil.com/x.png"))).toBe(false);
    expect(isReplicateDeliveryUrl(new URL("https://127.0.0.1/x.png?X-Amz-Signature=1"))).toBe(false);
  });
});
