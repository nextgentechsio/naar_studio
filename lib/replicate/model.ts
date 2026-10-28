// --------------------------------------------------
// MODEL ID VALIDATION
//
// Model IDs are interpolated into Replicate API URLs
// that carry our Bearer token. Without this check a
// value like "../account" resolves to /v1/account.
// --------------------------------------------------

const MODEL_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export function isValidModelId(
  value: unknown
): value is string {
  return (
    typeof value === "string" &&
    value.length <= 200 &&
    MODEL_ID_PATTERN.test(value)
  );
}

// "owner/name" -> "owner/name" with each segment encoded
export function modelPath(modelId: string): string {
  return modelId
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}
