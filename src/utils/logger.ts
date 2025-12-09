import winston from 'winston';
import { config } from '../config/config';

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    let log = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    if (stack) {
      log += `\n${stack}`;
    }
    return log;
  })
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  logFormat
);

export const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: consoleFormat,
    }),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 10485760,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 10485760,
      maxFiles: 5,
    }),
  ],
});

export function logDetection(data: {
  userId: string;
  guildId: string;
  method: string;
  confidence: number;
  action: string;
}): void {
  logger.info('Detection event', {
    type: 'detection',
    userId: maskUserId(data.userId),
    guildId: data.guildId,
    method: data.method,
    confidence: data.confidence,
    action: data.action,
  });
}

export function logBan(data: {
  userId: string;
  guildId?: string;
  level: number;
  reason: string;
}): void {
  logger.warn('Ban event', {
    type: 'ban',
    userId: maskUserId(data.userId),
    guildId: data.guildId,
    level: data.level,
    reason: data.reason,
  });
}

export function logError(error: Error, context?: Record<string, any>): void {
  logger.error('Error occurred', {
    error: error.message,
    stack: error.stack,
    context,
  });
}

function maskUserId(userId: string): string {
  if (userId.length < 8) return '***';
  return userId.substring(0, 4) + '***' + userId.substring(userId.length - 4);
}

export default logger;
