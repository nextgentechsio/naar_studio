import { describe, expect, it } from "vitest";
import { parseRange } from "@/lib/storage/generation-outputs";

describe("parseRange (saved output byte ranges)", () => {
  it("reads normal, open-ended and suffix ranges", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
  });

  it("serves the whole file when there's no usable header", () => {
    for (const header of [null, "", "bytes=", "items=0-1", "bytes=0-1,5-9", "bytes=a-b"]) {
      expect(parseRange(header, 1000), String(header)).toBeNull();
    }
  });

  it("flags ranges that can't be satisfied", () => {
    expect(parseRange("bytes=1000-", 1000)).toBe("invalid");
    expect(parseRange("bytes=50-10", 1000)).toBe("invalid");
    expect(parseRange("bytes=-0", 1000)).toBe("invalid");
  });
});
