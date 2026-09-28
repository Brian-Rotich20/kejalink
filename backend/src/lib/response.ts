// 
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

export const success = <T>(data: T): SuccessBody<T> => ({ success: true, data });

export const paginated = <T>(
  data: T[],
  params: { page: number; limit: number; total: number },
): SuccessBody<T[]> => ({
  success: true,
  data,
  meta: {
    page: params.page,
    limit: params.limit,
    total: params.total,
    totalPages: Math.max(1, Math.ceil(params.total / params.limit)),
  },
});

export const failure = (code: string, message: string, details: unknown = null): ErrorBody => ({
  success: false,
  error: { code, message, details },
});