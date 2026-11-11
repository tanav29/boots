import type { Turn } from "./types";

export function exportConversationAsMarkdown(turns: Turn[], title = "Conversation"): void {
  const lines: string[] = [`# ${title}\n`];
  lines.push(`*Exported on ${new Date().toLocaleString()}*\n\n---\n`);

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    lines.push(`### You\n\n${turn.userText}\n`);
    lines.push(`### Minimi\n\n${turn.assistantText || "*(No response recorded)*"}\n`);

    if (turn.sources && turn.sources.length > 0) {
      lines.push("#### Sources\n");
      for (const source of turn.sources) {
        lines.push(`- [${source.title || source.url}](${source.url})`);
      }
      lines.push("");
    }
    lines.push("---\n");
  }

  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  downloadBlob(blob, `${slugify(title)}-conversation.md`);
}

export function exportConversationAsJSON(turns: Turn[], title = "Conversation"): void {
  const data = {
    title,
    exportedAt: new Date().toISOString(),
    turns,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  downloadBlob(blob, `${slugify(title)}-conversation.json`);
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "minimi"
  );
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
