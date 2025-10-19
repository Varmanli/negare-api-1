const DEFAULT_UNIT = 's';

const UNIT_IN_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
};

/**
 * Parses duration strings like "10m", "1h", "30d" or numeric seconds into seconds.
 * Falls back to the provided default when the input is empty or invalid.
 */
export function parseDurationToSeconds(
  input: string | null | undefined,
  defaultSeconds = 600,
): number {
  if (!input) {
    return defaultSeconds;
  }

  const trimmed = input.trim().toLowerCase();
  const match = trimmed.match(/^(\d+)([smhd])?$/);
  if (!match) {
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : defaultSeconds;
  }

  const value = Number(match[1]);
  const unit = match[2] ?? DEFAULT_UNIT;
  const multiplier = UNIT_IN_SECONDS[unit] ?? UNIT_IN_SECONDS[DEFAULT_UNIT];

  return value * multiplier;
}
