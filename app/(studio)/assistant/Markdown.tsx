"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// --------------------------------------------------
// Claude's replies as formatted text: paragraphs, lists,
// tables, code, links (new tab). No raw HTML is rendered.
// --------------------------------------------------

const components: Components = {
  p: ({ children }) => <p className="my-3 leading-7 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1.5 pl-6 marker:text-fg-subtle">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1.5 pl-6 marker:text-fg-subtle">{children}</ol>,
  li: ({ children }) => <li className="pl-1 leading-7">{children}</li>,
  h1: ({ children }) => <h3 className="mb-2 mt-5 text-lg font-semibold text-fg first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-2 mt-5 text-base font-semibold text-fg first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-1.5 mt-4 font-semibold text-fg first:mt-0">{children}</h4>,
  strong: ({ children }) => <strong className="font-semibold text-fg">{children}</strong>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener" className="font-medium text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent">
      {children}
    </a>
  ),
  blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-line-strong pl-4 text-fg-muted">{children}</blockquote>,
  hr: () => <hr className="my-5 border-line" />,
  code: ({ className, children }) =>
    className ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded-md bg-fg/[0.07] px-1.5 py-0.5 font-mono text-[0.85em]">{children}</code>
    ),
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-xl border border-line bg-sunken p-4 font-mono text-[13px] leading-6 [scrollbar-width:thin]">{children}</pre>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-xl border border-line [scrollbar-width:thin]">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-fg/[0.04] text-left">{children}</thead>,
  th: ({ children }) => <th className="border-b border-line px-3 py-2 font-semibold text-fg">{children}</th>,
  td: ({ children }) => <td className="border-b border-line px-3 py-2 align-top [tr:last-child_&]:border-b-0">{children}</td>,
};

export default function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  );
}
