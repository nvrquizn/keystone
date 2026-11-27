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


/**
 * Restrict the LFG channel to recruitment posts. Deliberately favour clear
 * recruitment cues over guessing from any mention of an animal or "LFG".
 * The template is recommended, but short genuine requests are also accepted.
 */
export function isLfgRecruitment(content: string): boolean {
  const text = content.replace(/[*_~\x60]/g, "").trim();
  if (!text || text.length > 2000) return false;

  const animal = /^\s*(?:[-•]\s*)?animal\s*:\s*\S+/im.test(text);
  const details = /^\s*(?:[-•]\s*)?(?:players?\s*(?:needed|wanted)|play\s*style|server|group\s*size)\s*:\s*\S+/im.test(text);
  if (animal && details) return true;

  // Free-form LFG requests are also valid; ordinary questions/discussion aren't.
  const opening = text.replace(/^[\s>•-]+/, "").replace(/\s+/g, " ").trim();
  if (/^lfg\b/i.test(opening)) {
    const subject = opening.replace(/^lfg\b/i, "").replace(/^[\s:|•—–-]+/, "").trim();
    if (subject.length >= 3 && /^[\p{L}\p{N}]/u.test(subject) &&
        !/^(?:what|wut|why|how|where|this|the|channel|is|are|mean|means|rules?|help|can|should|not)\b/i.test(subject)) {
      return true;
    }
  }
  return /^(?:(?:anyone|anybody)(?:\s+here)?\s+(?:wanna|want(?:s)?\s+to|up\s+for|down\s+to)\s+(?:play|join)\b|who\s+(?:wants?\s+to|is\s+up\s+for)\s+(?:play|join)\b|looking\s+for\s+(?:a\s+)?(?:group|pack|party|players|people|teammates)\b|need\s+(?:\d+|some|more|a\s+few)\s+(?:players|people|teammates|members)\b|(?:hosting|starting)\s+(?:a\s+)?(?:group|pack|party|server)\b|join\s+my\s+(?:group|pack|party|server)\b|can\s+(?:anyone|anybody)\s+(?:play|join)\b)/i.test(opening);
}
