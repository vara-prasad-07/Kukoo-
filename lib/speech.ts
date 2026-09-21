/**
 * Prompts tell the models to speak plainly; this makes sure of it.
 *
 * A small model will still occasionally emit markdown, numbered lists or
 * newlines, and every one of those reads aloud as noise — "asterisk asterisk",
 * or a long dead pause. Sanitising once at the boundary is more reliable than
 * asking more firmly in the prompt.
 */
export function forSpeech(text: string): string {
  if (!text) return "";
  return (
    text
      // fenced code and inline backticks
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]*)`/g, "$1")
      // markdown emphasis, headings, quotes
      .replace(/[*_#>]/g, "")
      // leading bullets and list numbering, line by line
      .replace(/^[ \t]*[-–—•]\s+/gm, "")
      .replace(/^[ \t]*\d+[.)]\s+/gm, "")
      // links: keep the label, drop the target
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      // collapse every newline into a single spoken pause
      .replace(/\s*\n+\s*/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
  );
}
