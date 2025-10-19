const SCALE = 2n;
const SCALE_FACTOR = 10n ** SCALE;

function sanitizeInput(value: number | string): string {
  if (typeof value === 'number') {
    return value.toString();
  }
  return value;
}

function normalizeFraction(fraction: string): string {
  const normalized = (fraction + '00').slice(0, 2);
  return normalized;
}

export function parseAmountToMinorUnits(input: number | string): bigint {
  const raw = sanitizeInput(input).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    throw new Error('INVALID_AMOUNT_FORMAT');
  }
  const [whole, fraction = ''] = raw.split('.');
  const fractionNormalized = normalizeFraction(fraction);
  const digits = `${whole}${fractionNormalized}`.replace(/^0+(?=\d)/, '');
  return BigInt(digits || '0');
}

export function decimalStringToMinorUnits(value: string | number): bigint {
  const raw = sanitizeInput(value).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) {
    throw new Error('INVALID_DECIMAL');
  }
  const sign = raw.startsWith('-') ? -1n : 1n;
  const unsigned = sign === -1n ? raw.slice(1) : raw;
  const [whole, fraction = ''] = unsigned.split('.');
  const fractionNormalized = normalizeFraction(fraction);
  const digits = `${whole}${fractionNormalized}`.replace(/^0+(?=\d)/, '');
  return sign * BigInt(digits || '0');
}

export function minorUnitsToDecimalString(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const abs = value < 0n ? -value : value;
  const whole = abs / SCALE_FACTOR;
  const fraction = abs % SCALE_FACTOR;
  return `${sign}${whole.toString()}.${fraction.toString().padStart(2, '0')}`;
}

export function normalizeDecimalString(value: string): string {
  const minor = decimalStringToMinorUnits(value);
  return minorUnitsToDecimalString(minor);
}
