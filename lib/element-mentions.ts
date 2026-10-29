// --------------------------------------------------
// ELEMENT MENTIONS (shared by server and browser)
//
// An element is mentioned in a prompt as @name. Before a
// run is sent, each mention becomes plain words the model
// understands: the name, plus its description if it has
// one ("@maya walks" → "maya (a woman with red curly
// hair) walks"). Its files go in the model's matching
// inputs when it's picked: images, reference videos and
// voice (audio).
// --------------------------------------------------

export type Element = {
  id: string;
  name: string;
  description: string;
  images: string[];
  videos: string[];
  audios: string[];
  createdAt: string;
  updatedAt: string;
  // Who made it: only in the super admin's list of
  // everyone's elements
  addedBy?: { id: string; name: string };
};

// Letters, digits, "_" and "-": a mention ends at the
// first other character
export const ELEMENT_NAME = /^[\p{L}\p{N}_-]{1,40}$/u;

export const MAX_ELEMENT_IMAGES = 7;
export const MAX_ELEMENT_VIDEOS = 3;
export const MAX_ELEMENT_AUDIOS = 3;

export type ElementMediaKind = "image" | "video" | "audio";

// Each kind of file an element holds: its list on the
// element, how many it takes and what it's called
export const ELEMENT_MEDIA = [
  { kind: "image", list: "images", max: MAX_ELEMENT_IMAGES, one: "image", many: "images" },
  { kind: "video", list: "videos", max: MAX_ELEMENT_VIDEOS, one: "video", many: "videos" },
  { kind: "audio", list: "audios", max: MAX_ELEMENT_AUDIOS, one: "voice clip", many: "voice clips" },
] as const satisfies readonly {
  kind: ElementMediaKind;
  list: "images" | "videos" | "audios";
  max: number;
  one: string;
  many: string;
}[];

export const elementMedia = (kind: ElementMediaKind) => ELEMENT_MEDIA.find((item) => item.kind === kind)!;

// "3 images · 1 video", for lists
export function elementSummary(element: Pick<Element, "images" | "videos" | "audios">): string {
  return ELEMENT_MEDIA.filter((item) => element[item.list].length > 0)
    .map((item) => {
      const count = element[item.list].length;
      return `${count} ${count === 1 ? item.one : item.many}`;
    })
    .join(" · ");
}
export const MAX_ELEMENT_DESCRIPTION = 500;

export const ELEMENT_NAME_HINT =
  "1–40 letters, digits, _ or -, no spaces (it's typed as @name)";

// "@name" anywhere a word can start
const MENTION = /(^|[^\p{L}\p{N}_@-])@([\p{L}\p{N}_-]{1,40})/gu;

// The prompt as sent: known mentions spelled out, others
// left as typed (e.g. an email address or a handle)
export function expandMentions(prompt: string, elements: Element[]): string {
  const byName = new Map(elements.map((element) => [element.name.toLowerCase(), element]));

  return prompt.replace(MENTION, (whole, before: string, name: string) => {
    const element = byName.get(name.toLowerCase());
    if (!element) return whole;

    const description = element.description.trim();
    return `${before}${element.name}${description ? ` (${description})` : ""}`;
  });
}

// Elements a prompt mentions, in order, once each
export function mentionedElements(prompt: string, elements: Element[]): Element[] {
  const byName = new Map(elements.map((element) => [element.name.toLowerCase(), element]));
  const found = new Map<string, Element>();

  for (const match of prompt.matchAll(MENTION)) {
    const element = byName.get(match[2].toLowerCase());
    if (element) found.set(element.id, element);
  }

  return [...found.values()];
}
