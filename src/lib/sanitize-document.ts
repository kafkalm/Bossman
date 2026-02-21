/**
 * Sanitize document/content that may contain raw tool-call syntax from the model
 * (e.g. "[TOOL_CALL] { tool => \"save_to_workspace\", args => { --content \"...\" } }").
 * Extracts the actual content for saving or display.
 */
export function sanitizeDocumentContent(raw: string): string {
  if (typeof raw !== "string" || !raw.trim()) return raw;

  const s = raw.trim();

  // Try to extract from --content "..." (double-quoted; content may span lines and contain escaped ")
  const doubleMatch = s.match(/--content\s+"((?:[^"\\]|\\.)*)"/);
  if (doubleMatch?.[1] != null) {
    return doubleMatch[1].replace(/\\"/g, '"').trim();
  }

  // Try "content": "..." (JSON-like in args)
  const jsonContentMatch = s.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (jsonContentMatch?.[1] != null) {
    return jsonContentMatch[1].replace(/\\"/g, '"').trim();
  }

  // Try to extract from --content '...' (single-quoted)
  const singleMatch = s.match(/--content\s+'((?:[^'\\]|\\.)*)'/);
  if (singleMatch?.[1] != null) {
    return singleMatch[1].replace(/\\'/g, "'").trim();
  }

  // If content looks like it starts with [TOOL_CALL] or similar, drop that prefix
  // and return the rest (in case the model put content after the tool block)
  if (/^\s*\[?TOOL_CALL\]?\s*[\s\S]*?--content\s+/.test(s)) {
    // Already tried --content extraction above; if we're here, extraction failed.
    // Strip lines that look like tool-call header until we hit content-like lines
    const lines = s.split("\n");
    let start = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*\[?TOOL_CALL\]?|\s*tool\s*=>|\s*args\s*=>|--path\s+|--title\s+/i.test(line)) {
        continue;
      }
      if (/^\s*--content\s+["']/.test(line)) {
        start = i;
        break;
      }
      if (/^#|\S/.test(line)) {
        start = i;
        break;
      }
    }
    return lines.slice(start).join("\n").trim();
  }

  // Strip leading [TOOL_CALL] ... block if present (no --content found)
  const withoutPrefix = s.replace(/^\s*\[?TOOL_CALL\]?\s*\{[\s\S]*?\}\s*/i, "").trim();
  if (withoutPrefix !== s && withoutPrefix.length > 0) return withoutPrefix;

  return s;
}
