// API のエラー（{ error, message, details? }）を状態コードごとのクラスにする。

export type ErrorOptions = {
  status?: number;
  code?: string;
  details?: unknown;
  requestId?: string;
  cause?: unknown;
};

/** Base class for every error thrown by the SDK. */
export class VoicastError extends Error {
  override name = 'VoicastError';
  /** HTTP status. Undefined when no response was received. */
  readonly status: number | undefined;
  /** API error code, such as `invalid_request`, `not_found` or `balance_depleted`. */
  readonly code: string | undefined;
  /** Extra information from the API, such as the list of invalid fields for a 422. */
  readonly details: unknown;
  /** Request ID (`x-request-id`) to quote when contacting support. */
  readonly requestId: string | undefined;

  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
    this.requestId = options.requestId;
  }
}

/** 401: the API key is missing, wrong or revoked. */
export class AuthenticationError extends VoicastError {
  override name = 'AuthenticationError';
}

/** 402: a new call or session was refused for billing (`balance_depleted`). */
export class PaymentRequiredError extends VoicastError {
  override name = 'PaymentRequiredError';
}

/** 403: the operation is not allowed. */
export class PermissionError extends VoicastError {
  override name = 'PermissionError';
}

/** 404: the resource does not exist in the key's environment. */
export class NotFoundError extends VoicastError {
  override name = 'NotFoundError';
}

/** 409: conflicts with the current state (duplicate `external_id`, agent `in_use`, `tenant_disabled`, `needs_reauth`). */
export class ConflictError extends VoicastError {
  override name = 'ConflictError';
}

/** 400 or 422: the request body or parameters are invalid. See `details`. */
export class ValidationError extends VoicastError {
  override name = 'ValidationError';
}

/** 429: too many requests. Thrown after retries are used up. */
export class RateLimitError extends VoicastError {
  override name = 'RateLimitError';
  /** Seconds to wait before retrying, from `retry-after`. */
  readonly retryAfter: number | undefined;

  constructor(message: string, options: ErrorOptions & { retryAfter?: number } = {}) {
    super(message, options);
    this.retryAfter = options.retryAfter;
  }
}

/** Any other error response, including 5xx. */
export class ApiError extends VoicastError {
  override name = 'ApiError';
}

/** The request could not reach the API (DNS, TCP, TLS) or was aborted. */
export class ConnectionError extends VoicastError {
  override name = 'ConnectionError';
}

/** The request did not complete within `timeout`. */
export class TimeoutError extends ConnectionError {
  override name = 'TimeoutError';
}

/** Signature verification of an incoming webhook or tool call failed. */
export class WebhookVerificationError extends VoicastError {
  override name = 'WebhookVerificationError';
}

type ErrorBody = { error?: unknown; message?: unknown; details?: unknown };

/** Seconds from `retry-after` (seconds or HTTP date). */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const n = Number(value);
  if (Number.isFinite(n)) return Math.max(0, n);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, (at - now) / 1000);
}

export function requestIdOf(headers: Headers): string | undefined {
  return headers.get('x-request-id') ?? headers.get('cf-ray') ?? undefined;
}

/** Builds the error for a non-2xx response. `text` is the raw response body. */
export function errorFromResponse(status: number, text: string, headers: Headers): VoicastError {
  let body: ErrorBody = {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object') body = parsed as ErrorBody;
  } catch {
    // HTML from a proxy, empty body, etc.
  }
  const options: ErrorOptions = {
    status,
    code: typeof body.error === 'string' ? body.error : undefined,
    details: body.details,
    requestId: requestIdOf(headers),
  };
  const message = typeof body.message === 'string' ? body.message : `HTTP ${status}`;
  switch (status) {
    case 401:
      return new AuthenticationError(message, options);
    case 402:
      return new PaymentRequiredError(message, options);
    case 403:
      return new PermissionError(message, options);
    case 404:
      return new NotFoundError(message, options);
    case 409:
      return new ConflictError(message, options);
    case 400:
    case 422:
      return new ValidationError(message, options);
    case 429:
      return new RateLimitError(message, { ...options, retryAfter: parseRetryAfter(headers.get('retry-after')) });
    default:
      return new ApiError(message, options);
  }
}
