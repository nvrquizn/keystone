/** Small, readable thread titles derived from the LFG message. */
export function lfgThreadName(content: string, fallbackName: string): string {
  const firstLine = content.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? "";
  const clean = firstLine
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/<[@#][!&]?\d+>/g, "")
    .replace(/[@]\b(?:everyone|here)\b/gi, "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[`*_~>#|]/g, "")
    .replace(/\s+/g, " ").trim();
  const animalMatch = clean.match(/^animal\s*:\s*(.+)$/i);
  const subject = (animalMatch?.[1] || clean || fallbackName.trim() || "Group")
    .slice(0, 94).trim();
  return ("LFG • " + subject).slice(0, 100);
}
