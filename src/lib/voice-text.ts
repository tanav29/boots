/** Pure shared text transforms: safe to use in the browser without provider code. */
/** Defense in depth for models that put reasoning tags in content despite exclusion. */
export class PublicTextFilter {
  private pending = "";
  private hidden: string | null = null;

  push(delta: string, final = false): string {
    this.pending += delta;
    let output = "";
    while (this.pending) {
      if (this.hidden) {
        const close = `</${this.hidden}>`;
        const end = this.pending.toLowerCase().indexOf(close);
        if (end < 0) {
          this.pending = this.pending.slice(-close.length);
          break;
        }
        this.pending = this.pending.slice(end + close.length);
        this.hidden = null;
      } else {
        const match = /<(think|thinking|analysis|reasoning)>/i.exec(this.pending);
        if (match) {
          output += this.pending.slice(0, match.index);
          this.pending = this.pending.slice(match.index + match[0].length);
          this.hidden = match[1].toLowerCase();
        } else {
          const partial = this.pending.lastIndexOf("<");
          if (!final && partial >= 0 && !this.pending.slice(partial).includes(">")) {
            output += this.pending.slice(0, partial);
            this.pending = this.pending.slice(partial);
            break;
          }
          output += this.pending;
          this.pending = "";
        }
      }
    }
    return output;
  }
}

export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[(?:S\d+|\d+|unverified source)\]/gi, "")
    .replace(/https?:\/\/[^\s)]+/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/^\s{0,3}(?:#{1,6}\s*|>\s*|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/[*_~|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lines are buffered so split Markdown fences and URLs never become speech. */
export class SpeechSegmenter {
  private buffer = "";
  private inCode = false;

  push(delta: string, final = false): string[] {
    this.buffer += delta;
    const output: string[] = [];
    while (this.buffer) {
      const newline = this.buffer.indexOf("\n");
      if (this.inCode || this.buffer.trimStart().startsWith("```")) {
        if (newline < 0 && !final) break;
        const line = newline < 0 ? this.buffer : this.buffer.slice(0, newline);
        this.buffer = newline < 0 ? "" : this.buffer.slice(newline + 1);
        if (line.trimStart().startsWith("```")) this.inCode = !this.inCode;
        continue;
      }
      // Do not split inside Markdown links, citations, inline code, or decimals.
      const boundary = /[.!?](?=\s|$)|\n/.exec(this.buffer);
      let end = boundary ? boundary.index + 1 : -1;
      if (end >= 0 && !final && end === this.buffer.length) break;
      if (end >= 0) {
        const prefix = this.buffer.slice(0, end);
        if (
          (prefix.match(/\[/g)?.length || 0) > (prefix.match(/\]/g)?.length || 0) ||
          (prefix.match(/`/g)?.length || 0) % 2
        ) {
          end = newline >= 0 ? newline + 1 : -1;
        }
      }
      if (end < 0 && !final) break;
      if (end < 0) end = this.buffer.length;
      const chunk = speakable(this.buffer.slice(0, end));
      this.buffer = this.buffer.slice(end);
      if (chunk) {
        // Long table rows / run-on sentences stay within the speech endpoint bound.
        const words = chunk.split(" ");
        let part = "";
        for (const word of words) {
          if (part.length + word.length > 600 && part) {
            output.push(part);
            part = "";
          }
          part += (part ? " " : "") + word;
        }
        if (part) output.push(part.slice(0, 1200));
      }
    }
    return output;
  }
}
