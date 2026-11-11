"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

interface CodeBlockProps {
  language?: string;
  code: string;
}

export function CodeBlock({ language, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="my-4 overflow-hidden rounded-xl border border-zinc-200 text-sm">
      <div className="flex items-center justify-between bg-zinc-50 px-4 py-2 text-xs text-zinc-500">
        <span>{language || "Code"}</span>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-zinc-200/60 hover:text-zinc-800"
          onClick={handleCopy}
          aria-label="Copy code to clipboard"
          title="Copy code"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-6 text-zinc-700">
        <code>{code}</code>
      </pre>
    </div>
  );
}
