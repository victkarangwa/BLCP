import * as Joi from 'joi';

/**
 * Boot-time configuration validation.
 *
 * The application MUST refuse to start if any of these are missing or weak.
 * A missing JWT_SECRET in production is a critical failure, not a warning.
 * Validation runs before module initialization (via ConfigModule.forRoot).
 */
export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  PORT: Joi.number().port().default(3000),

  // 32 bytes = 256 bits, the minimum for HS256 to be cryptographically sound.
  JWT_SECRET: Joi.string().min(32).required().messages({
    'string.min': 'JWT_SECRET must be at least 32 characters (256 bits).',
    'any.required': 'JWT_SECRET is required.',
  }),

  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required(),
  // ADMIN_URL is only needed for migrations/seeding, not at runtime.
  // Optional here so the running app doesn't fail if it's missing.
  DATABASE_ADMIN_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .optional(),

  FRONTEND_ORIGIN: Joi.string().uri().required(),
  STORAGE_ROOT: Joi.string().default('./storage'),
});
