import { describe, expect, it } from "vitest";
import { elementSummary, expandMentions, mentionedElements, type Element } from "@/lib/element-mentions";

const element = (name: string, description = ""): Element => ({
  id: name,
  name,
  description,
  images: [`https://x/${name}.png`],
  videos: [],
  audios: [],
  createdAt: "",
  updatedAt: "",
});

const maya = element("Maya", "a woman with red curly hair");
const bottle = element("blue-bottle");

describe("element mentions", () => {
  it("spells out known mentions with their description", () => {
    expect(expandMentions("@maya holds @blue-bottle.", [maya, bottle])).toBe(
      "Maya (a woman with red curly hair) holds blue-bottle."
    );
  });

  it("leaves unknown mentions, emails and handles as typed", () => {
    expect(expandMentions("mail me@maya.com, @someone, @@maya", [maya])).toBe(
      "mail me@maya.com, @someone, @@maya"
    );
  });

  it("matches at the start, after punctuation and line breaks", () => {
    expect(expandMentions("@Maya\n(@maya)", [element("Maya")])).toBe("Maya\n(Maya)");
  });

  it("lists mentioned elements once, in order", () => {
    expect(mentionedElements("@blue-bottle and @maya and @MAYA", [maya, bottle]).map((e) => e.name)).toEqual([
      "blue-bottle",
      "Maya",
    ]);
  });

  it("sums up an element's files by kind", () => {
    expect(elementSummary(maya)).toBe("1 image");
    expect(elementSummary({ images: ["a", "b"], videos: ["v"], audios: ["x", "y"] })).toBe(
      "2 images · 1 video · 2 voice clips"
    );
    expect(elementSummary({ images: [], videos: [], audios: ["x"] })).toBe("1 voice clip");
  });
});
