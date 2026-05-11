import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Singleton Prisma client wrapper.
 *
 * Why a service and not just `new PrismaClient()` everywhere:
 *  - Single connection pool across the app (PrismaClient holds a pool).
 *  - Lifecycle hooks tied to Nest's module init/destroy.
 *  - Mockable in tests via DI.
 *
 * The Prisma docs once recommended `enableShutdownHooks` here; that pattern
 * was deprecated in Prisma 5 because Nest's onModuleDestroy already runs
 * before the process exits. Calling $disconnect there is enough.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
