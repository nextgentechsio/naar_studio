import { describe, expect, it } from "vitest";
import { APP_NAME, copyrightLine, versionLabel } from "@/lib/app-info";

describe("app name, version and copyright", () => {
  it("names the app", () => {
    expect(APP_NAME).toBe("NAAR Studio");
  });

  it("shows one year, then a range", () => {
    expect(copyrightLine(new Date(2026, 9, 28))).toBe("© 2026 NAAR. All rights reserved.");
    expect(copyrightLine(new Date(2028, 0, 1))).toBe("© 2026–2028 NAAR. All rights reserved.");
  });

  it("labels the version", () => {
    expect(versionLabel()).toMatch(/^v\d+\.\d+\.\d+$/);
  });
});
