const ON = /^(1|true|on|yes)$/i;
const OFF = /^(0|false|off|no)$/i;

/** A boolean env var: true/false for the usual spellings (any case), else undefined. */
export function envToggle(value: string | undefined): boolean | undefined {
  const text = (value ?? '').trim();
  if (ON.test(text)) return true;

  if (OFF.test(text)) return false;

  return undefined;
}

/** A default-on style flag: unset uses `fallback`; anything but an "off" spelling is on. */
export function envFlag(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === '') return fallback;

  return !OFF.test(value.trim());
}

/** An opt-in flag: only an explicit "on" spelling enables it. */
export function envEnabled(value: string | undefined): boolean {
  return envToggle(value) === true;
}
