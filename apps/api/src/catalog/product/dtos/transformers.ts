// apps/api/src/core/catalog/product/dto/transformers.ts
import { TransformFnParams } from 'class-transformer';

export function toTrimmedString({
  value,
}: TransformFnParams): string | undefined {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s.length ? s : undefined;
}

export function toStringArray({
  value,
}: TransformFnParams): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.map((v) => String(v));
  // اجازه‌ی ورودی comma-separated
  return String(value)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

/** اطمینان از اینکه مقدار ورودی، رشته‌ی عددیِ BigInt است */
export function toBigIntString({
  value,
}: TransformFnParams): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const s = String(value).trim();
  if (!/^\d+$/.test(s)) return undefined;
  return s;
}

/** آرایه‌ای از رشته‌های BigInt (مثلاً categoryIds) */
export function toBigIntStringArray({
  value,
}: TransformFnParams): string[] | undefined {
  const arr = toStringArray({ value } as TransformFnParams);
  if (!arr) return undefined;
  const out = arr.filter((s) => /^\d+$/.test(s));
  return out.length ? out : [];
}
