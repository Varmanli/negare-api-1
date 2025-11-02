export interface PaginationResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasNext: boolean;
}

export const MAX_LIMIT = 100;

export function clampPagination(
  page: number | undefined,
  limit: number | undefined,
  maxLimit = MAX_LIMIT,
): { page: number; limit: number; skip: number } {
  const safePage = page && page > 0 ? page : 1;
  const safeLimit =
    limit && limit > 0 ? Math.min(limit, maxLimit) : Math.min(24, maxLimit);
  const skip = (safePage - 1) * safeLimit;
  return { page: safePage, limit: safeLimit, skip };
}

export function toPaginationResult<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): PaginationResult<T> {
  return {
    data,
    total,
    page,
    limit,
    hasNext: page * limit < total,
  };
}
