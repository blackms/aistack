/**
 * Error handling middleware
 */

import type { ServerResponse } from 'node:http';
import { logger } from '../../utils/logger.js';

const log = logger.child('web:error');

export class ApiError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'ApiError';
  }
}

export function handleError(res: ServerResponse, error: unknown): void {
  const statusCode = error instanceof ApiError ? error.statusCode : 500;
  const message = error instanceof Error ? error.message : 'Internal server error';

  if (statusCode >= 500) {
    log.error('Server error', { error: message, stack: error instanceof Error ? error.stack : undefined });
  } else {
    log.warn('Client error', { statusCode, message });
  }

  if (!res.headersSent) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: false,
      error: message,
      timestamp: new Date().toISOString(),
    }));
  }
}

// Common error factory functions
export function notFound(resource: string): ApiError {
  return new ApiError(404, `${resource} not found`);
}

export function badRequest(message: string): ApiError {
  return new ApiError(400, message);
}

export function unauthorized(message: string = 'Unauthorized'): ApiError {
  return new ApiError(401, message);
}

export function forbidden(message: string = 'Forbidden'): ApiError {
  return new ApiError(403, message);
}

export function conflict(message: string): ApiError {
  return new ApiError(409, message);
}

export function serverError(message: string = 'Internal server error'): ApiError {
  return new ApiError(500, message);
}
