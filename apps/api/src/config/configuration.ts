/**
 * Strongly-typed configuration loader.
 *
 * Why a function and not class-config: simpler, no decorators, plays nicely
 * with @nestjs/config's `load:` option. We validate via Joi separately
 * (validation.schema.ts) — this just shapes the values.
 */
export interface AppConfig {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  jwtSecret: string;
  databaseUrl: string;
  frontendOrigin: string;
  storageRoot: string;
}

export default (): AppConfig => ({
  nodeEnv: (process.env.NODE_ENV as AppConfig['nodeEnv']) ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  jwtSecret: process.env.JWT_SECRET ?? '',
  databaseUrl: process.env.DATABASE_URL ?? '',
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3001',
  storageRoot: process.env.STORAGE_ROOT ?? './storage',
});
