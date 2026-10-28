import { describe, expect, it } from "vitest";
import { inputSchemaFromModel, shapeInputs } from "@/lib/replicate/inputs";

const model = {
  latest_version: {
    openapi_schema: {
      components: {
        schemas: {
          Input: {
            required: ["prompt"],
            properties: {
              prompt: { type: "string" },
              image: { type: "string", format: "uri" },
              image_input: { type: "array", items: { type: "string" } },
              seed: { type: "integer" },
              scale: { type: "number" },
              aspect_ratio: { allOf: [{ $ref: "#/components/schemas/aspect_ratio" }] },
            },
          },
          aspect_ratio: { type: "string", enum: ["1:1", "16:9"] },
        },
      },
    },
  },
};

const schema = inputSchemaFromModel(model);

describe("inputSchemaFromModel", () => {
  it("reads properties, required fields and $ref enums", () => {
    expect(schema?.required).toEqual(["prompt"]);
    expect(schema?.properties.image_input.type).toBe("array");
    expect(schema?.properties.aspect_ratio.type).toBe("string");
  });

  it("returns null for anything that isn't a model", () => {
    for (const value of [null, {}, { latest_version: null }, "x", []]) {
      expect(inputSchemaFromModel(value)).toBeNull();
    }
  });
});

describe("shapeInputs", () => {
  it("sends one URL where the model takes one (upscalers)", () => {
    expect(shapeInputs({ image: ["https://a/x.png"] }, schema)).toEqual({
      image: "https://a/x.png",
    });
  });

  it("wraps a single value where the model takes a list", () => {
    expect(shapeInputs({ image_input: "https://a/x.png" }, schema)).toEqual({
      image_input: ["https://a/x.png"],
    });
  });

  it("drops optional blanks so the model uses its default", () => {
    expect(
      shapeInputs({ prompt: "p", seed: "", image: [], scale: null }, schema)
    ).toEqual({ prompt: "p" });
  });

  it("keeps a required field even when blank (Replicate reports it)", () => {
    expect(shapeInputs({ prompt: "" }, schema)).toEqual({ prompt: "" });
  });

  it("turns numeric strings into numbers for number fields", () => {
    expect(shapeInputs({ seed: "42", scale: "1.5" }, schema)).toEqual({
      seed: 42,
      scale: 1.5,
    });
  });

  it("keeps only http(s) URLs in the media fields", () => {
    expect(
      shapeInputs(
        {
          start_image: ["javascript:alert(1)", "https://ok/a.png"],
          end_image: "file:///etc/passwd",
          reference_images: ["https://ok/b.png", 3, "ftp://x"],
          reference_video: [],
        },
        null
      )
    ).toEqual({ start_image: "https://ok/a.png", reference_images: ["https://ok/b.png"] });
  });

  it("wraps a plain multi_prompt as JSON", () => {
    expect(JSON.parse(String(shapeInputs({ multi_prompt: "a cat", duration: 8 }, null).multi_prompt))).toEqual([
      { prompt: "a cat", duration: 8 },
    ]);
  });

  it("does not mutate its input", () => {
    const raw = { image: ["https://a/x.png"] };
    shapeInputs(raw, schema);
    expect(raw).toEqual({ image: ["https://a/x.png"] });
  });
});
