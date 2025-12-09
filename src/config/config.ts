import dotenv from 'dotenv';

dotenv.config();

interface Config {
  discord: {
    token: string;
    clientId: string;
    clientSecret: string;
  };
  database: {
    url: string;
  };
  dashboard: {
    port: number;
    url: string;
    jwtSecret: string;
  };
  detection: {
    workerUrl?: string;
    workerApiKey?: string;
    sightengine?: {
      apiUser: string;
      apiSecret: string;
    };
    enableMLModel: boolean;
    detectionThreshold: number;
    reviewThreshold: number;
    maxConcurrentScans: number;
    imageMaxSizeMB: number;
  };
  logging: {
    level: string;
    retentionDays: number;
  };
  security: {
    encryptionKey: string;
  };
  environment: string;
}

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (!value && !defaultValue) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value || defaultValue!;
}

function getOptionalEnvVar(key: string): string | undefined {
  return process.env[key];
}

export const config: Config = {
  discord: {
    token: getEnvVar('DISCORD_BOT_TOKEN'),
    clientId: getEnvVar('DISCORD_CLIENT_ID'),
    clientSecret: getEnvVar('DISCORD_CLIENT_SECRET'),
  },
  database: {
    url: getEnvVar('DATABASE_URL', 'file:./dev.db'),
  },
  dashboard: {
    port: parseInt(getEnvVar('DASHBOARD_PORT', '3000')),
    url: getEnvVar('DASHBOARD_URL', 'http://localhost:3000'),
    jwtSecret: getEnvVar('JWT_SECRET'),
  },
  detection: {
    workerUrl: getOptionalEnvVar('WORKER_URL'),
    workerApiKey: getOptionalEnvVar('WORKER_API_KEY'),
    sightengine: getOptionalEnvVar('SIGHTENGINE_API_USER') && getOptionalEnvVar('SIGHTENGINE_API_SECRET')
      ? {
          apiUser: getOptionalEnvVar('SIGHTENGINE_API_USER')!,
          apiSecret: getOptionalEnvVar('SIGHTENGINE_API_SECRET')!,
        }
      : undefined,
    enableMLModel: getEnvVar('ENABLE_ML_MODEL', 'false') === 'true',
    detectionThreshold: parseFloat(getEnvVar('DETECTION_THRESHOLD', '0.85')),
    reviewThreshold: parseFloat(getEnvVar('REVIEW_THRESHOLD', '0.70')),
    maxConcurrentScans: parseInt(getEnvVar('MAX_CONCURRENT_SCANS', '2')),
    imageMaxSizeMB: parseInt(getEnvVar('IMAGE_MAX_SIZE_MB', '10')),
  },
  logging: {
    level: getEnvVar('LOG_LEVEL', 'info'),
    retentionDays: parseInt(getEnvVar('LOG_RETENTION_DAYS', '90')),
  },
  security: {
    encryptionKey: getEnvVar('ENCRYPTION_KEY'),
  },
  environment: getEnvVar('NODE_ENV', 'development'),
};

export function validateConfig(): void {
  if (!config.discord.token) {
    throw new Error('Discord bot token is required');
  }

  if (!config.detection.workerUrl && !config.detection.sightengine) {
    console.warn('Warning: No cloud detection API configured. Only hash matching will be available.');
  }

  if (config.dashboard.jwtSecret.length < 32) {
    throw new Error('JWT secret must be at least 32 characters long');
  }

  if (config.security.encryptionKey.length < 32) {
    throw new Error('Encryption key must be at least 32 characters long');
  }

  console.log('Configuration validated successfully');
}
