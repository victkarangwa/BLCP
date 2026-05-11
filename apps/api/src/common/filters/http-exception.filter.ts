import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { DomainError } from '../errors/domain-errors';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Global exception filter. Two responsibilities:
 *
 *   1. Translate every thrown error into the standard envelope, never
 *      leaking stack traces, internal messages, or framework noise.
 *
 *   2. Log 5xx errors (with stack) for ops, but stay quiet on 4xx —
 *      those are expected and would drown the logs.
 *
 * The frontend switches on `error.code`, not `error.message`. Codes are
 * stable across releases; messages may change.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const requestId = (req.headers['x-request-id'] as string) ?? randomUUID();

    const { status, body } = this.toResponse(exception, requestId);

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.url} → ${status} [${requestId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    res.status(status).json(body);
  }

  private toResponse(
    exception: unknown,
    requestId: string,
  ): { status: number; body: ErrorBody } {
    // 1. Our typed domain errors (most precise).
    if (exception instanceof DomainError) {
      return {
        status: exception.httpStatus,
        body: {
          error: {
            code: exception.code,
            message: exception.message,
            requestId,
            details: exception.details,
          },
        },
      };
    }

    // 2. Nest's HttpException tree (BadRequest, Forbidden, etc.).
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const { code, message, details } = this.normalizeNestException(
        response,
        status,
      );
      return { status, body: { error: { code, message, requestId, details } } };
    }

    // 3a. Multer errors → useful HTTP responses for upload failures.
    //     LIMIT_FILE_SIZE is the common one (5 MB cap).
    if (
      typeof exception === 'object' &&
      exception !== null &&
      'name' in exception &&
      (exception as { name: string }).name === 'MulterError'
    ) {
      const code = (exception as { code?: string }).code;
      if (code === 'LIMIT_FILE_SIZE') {
        return {
          status: HttpStatus.PAYLOAD_TOO_LARGE,
          body: {
            error: {
              code: 'DOCUMENT_TOO_LARGE',
              message: 'File exceeds the 5 MB limit',
              requestId,
            },
          },
        };
      }
      return {
        status: HttpStatus.BAD_REQUEST,
        body: {
          error: {
            code: 'UPLOAD_ERROR',
            message: (exception as Error).message ?? 'Upload failed',
            requestId,
          },
        },
      };
    }

    // 3. Known Prisma errors → useful HTTP responses.
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return {
          status: HttpStatus.CONFLICT,
          body: {
            error: {
              code: 'DUPLICATE_RESOURCE',
              message: 'Resource already exists',
              requestId,
            },
          },
        };
      }
      if (exception.code === 'P2025') {
        return {
          status: HttpStatus.NOT_FOUND,
          body: {
            error: {
              code: 'NOT_FOUND',
              message: 'Resource not found',
              requestId,
            },
          },
        };
      }
    }

    // 4. Anything else: opaque 500. NEVER leak the original message.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
          requestId,
        },
      },
    };
  }

  private normalizeNestException(
    response: unknown,
    status: number,
  ): { code: string; message: string; details?: Record<string, unknown> } {
    // Validation pipe returns { message: string[], error: 'Bad Request' }.
    if (
      status === 400 &&
      typeof response === 'object' &&
      response !== null &&
      'message' in response &&
      Array.isArray(response.message)
    ) {
      return {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        details: { issues: (response as { message: string[] }).message },
      };
    }

    // Structured payload (e.g., new ConflictException({ code, message })).
    if (typeof response === 'object' && response !== null) {
      const r = response as { code?: string; message?: string };
      if (r.code) return { code: r.code, message: r.message ?? 'Error' };
    }

    const message = typeof response === 'string' ? response : 'Error';
    return { code: this.codeForStatus(status), message };
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case 401:
        return 'UNAUTHENTICATED';
      case 403:
        return 'FORBIDDEN';
      case 404:
        return 'NOT_FOUND';
      case 409:
        return 'CONFLICT';
      case 413:
        return 'DOCUMENT_TOO_LARGE';
      case 429:
        return 'RATE_LIMITED';
      default:
        return 'INTERNAL_ERROR';
    }
  }
}
