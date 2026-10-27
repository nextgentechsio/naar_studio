// --------------------------------------------------
// ELEMENT MENTIONS (shared by server and browser)
//
// An element is mentioned in a prompt as @name. Before a
// run is sent, each mention becomes plain words the model
// understands: the name, plus its description if it has
// one ("@maya walks" → "maya (a woman with red curly
// hair) walks"). Its images go in the model's image input
// when it's picked.
// --------------------------------------------------

export type Element = {
  id: string;
  name: string;
  description: string;
  images: string[];
  createdAt: string;
  updatedAt: string;
};

// Letters, digits, "_" and "-": a mention ends at the
// first other character
export const ELEMENT_NAME = /^[\p{L}\p{N}_-]{1,40}$/u;

export const MAX_ELEMENT_IMAGES = 7;
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
