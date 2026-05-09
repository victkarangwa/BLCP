import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';

/**
 * Request logging + correlation ID propagation.
 *
 *  - Reads X-Request-ID from the client, or mints a fresh one.
 *  - Echoes it back as a response header so clients can quote it in support.
 *  - Logs request completion with duration and authenticated user.
 *
 * Errors are NOT logged here — the global exception filter does that, so
 * we don't end up double-logging failures.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Http');

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: { id: string } }>();
    const res = ctx.switchToHttp().getResponse<Response>();

    const requestId = (req.headers['x-request-id'] as string) ?? randomUUID();
    req.headers['x-request-id'] = requestId;
    res.setHeader('X-Request-ID', requestId);

    const start = Date.now();
    const userId = req.user?.id ?? 'anon';

    return next.handle().pipe(
      tap(() => {
        this.logger.log(
          `${req.method} ${req.url} ${res.statusCode} ${Date.now() - start}ms [${requestId}] user=${userId}`,
        );
      }),
    );
  }
}
