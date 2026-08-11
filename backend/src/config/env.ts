import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL URL'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /// Uno o más orígenes separados por coma (p. ej. www.aerocamo.cl,app.aerocamo.cl)
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  
  // Email configuration
  EMAIL_PROVIDER: z.enum(['smtp', 'sendgrid']).default('smtp'),
  EMAIL_FROM_ADDRESS: z.string().email().default('noreply@plataforma.com'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),

  // WhatsApp Business (Meta Cloud API)
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_TEMPLATE_NAME: z.string().default('nueva_solicitud_trabajo'),
  WHATSAPP_TEMPLATE_LANG: z.string().default('es'),
  WHATSAPP_API_VERSION: z.string().default('v21.0'),
  /// Solo para pruebas locales: apunta la API a otro host
  WHATSAPP_API_BASE_URL: z.string().optional(),
  /// Prefijo que se antepone a los teléfonos guardados sin código de país
  WHATSAPP_DEFAULT_COUNTRY_CODE: z.string().default('56'),
  
  // AWS S3 configuration
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_REGION: z.string().default('us-east-1'),
  AWS_S3_BUCKET: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌  Invalid environment variables:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const rawEnv = parsed.data;

export const env = {
  // Maintain backward compatibility with uppercase keys
  NODE_ENV: rawEnv.NODE_ENV,
  PORT: rawEnv.PORT,
  DATABASE_URL: rawEnv.DATABASE_URL,
  JWT_SECRET: rawEnv.JWT_SECRET,
  JWT_EXPIRES_IN: rawEnv.JWT_EXPIRES_IN,
  LOG_LEVEL: rawEnv.LOG_LEVEL,
  CORS_ORIGIN: rawEnv.CORS_ORIGIN,
  
  // New camelCase versions for cleaner new code
  nodeEnv: rawEnv.NODE_ENV,
  port: rawEnv.PORT,
  databaseUrl: rawEnv.DATABASE_URL,
  jwtSecret: rawEnv.JWT_SECRET,
  jwtExpiresIn: rawEnv.JWT_EXPIRES_IN,
  logLevel: rawEnv.LOG_LEVEL,
  corsOrigin: rawEnv.CORS_ORIGIN,
  
  // Email configuration
  email: {
    provider: rawEnv.EMAIL_PROVIDER,
    fromAddress: rawEnv.EMAIL_FROM_ADDRESS,
    smtpHost: rawEnv.SMTP_HOST,
    smtpPort: rawEnv.SMTP_PORT,
    smtpSecure: rawEnv.SMTP_SECURE,
    smtpUser: rawEnv.SMTP_USER,
    smtpPass: rawEnv.SMTP_PASS,
    sendgridApiKey: rawEnv.SENDGRID_API_KEY,
  },

  whatsapp: {
    phoneNumberId: rawEnv.WHATSAPP_PHONE_NUMBER_ID,
    accessToken: rawEnv.WHATSAPP_ACCESS_TOKEN,
    templateName: rawEnv.WHATSAPP_TEMPLATE_NAME,
    templateLang: rawEnv.WHATSAPP_TEMPLATE_LANG,
    apiVersion: rawEnv.WHATSAPP_API_VERSION,
    apiBaseUrl: rawEnv.WHATSAPP_API_BASE_URL,
    defaultCountryCode: rawEnv.WHATSAPP_DEFAULT_COUNTRY_CODE,
  },
  
  // AWS S3 configuration
  aws: {
    accessKeyId: rawEnv.AWS_ACCESS_KEY_ID,
    secretAccessKey: rawEnv.AWS_SECRET_ACCESS_KEY,
    region: rawEnv.AWS_REGION,
    s3Bucket: rawEnv.AWS_S3_BUCKET,
  },
};

export type Env = typeof env;
