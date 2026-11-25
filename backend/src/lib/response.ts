export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface SuccessBody<T> {
  success: true;
  data: T;
  meta?: PaginationMeta;
}

export interface ErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details: unknown;
  };
}

export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

export const success = <T>(data: T): SuccessBody<T> => ({ success: true, data });

export const paginated = <T>(page: Page<T>): SuccessBody<T[]> => ({
  success: true,
  data: page.items,
  meta: {
    page: page.page,
    limit: page.limit,
    total: page.total,
    totalPages: Math.max(1, Math.ceil(page.total / page.limit)),
  },
});

export const failure = (code: string, message: string, details: unknown = null): ErrorBody => ({
  success: false,
  error: { code, message, details },
});
