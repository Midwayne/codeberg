/** Models sometimes wrap valid JSON in prose or a fenced block; try each plausible candidate. */
export function parseModelJson(raw: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)?.[1];
  const candidates = [fenced, raw.trim(), ...jsonObjects(raw)].filter(
    (candidate): candidate is string => Boolean(candidate?.trim()),
  );

  for (const candidate of new Set(candidates)) {
    try {
      return JSON.parse(candidate.trim()) as unknown;
    } catch {
      // Try the next candidate.
    }
  }

  return undefined;
}

function jsonObjects(raw: string): string[] {
  const objects: string[] = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;

      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === '{') {
      if (depth === 0) start = index;

      depth++;
    } else if (char === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        objects.push(raw.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return objects;
}
