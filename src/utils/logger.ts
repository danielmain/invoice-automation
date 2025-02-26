import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { config } from '../config/config';

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Define log format
const logFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

// Create logger instance
export const logger = winston.createLogger({
    level: config.server.environment === 'development' ? 'debug' : 'info',
    format: logFormat,
    defaultMeta: { service: 'invoice-automation' },
    transports: [
        // Console transport for all environments
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            ),
        }),
        // File transport for all logs
        new winston.transports.File({
            filename: path.join(logsDir, 'combined.log'),
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
        // File transport for error logs
        new winston.transports.File({
            filename: path.join(logsDir, 'error.log'),
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
    ],
});

// Log unhandled rejections and exceptions
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Promise Rejection', { reason, promise });
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception', { error });
    process.exit(1);
});

// Expose a function to add request ID to log context
export function createContextLogger(requestId: string) {
    return {
        info: (message: string, meta: object = {}) => {
            logger.info(message, { ...meta, requestId });
        },
        error: (message: string, meta: object = {}) => {
            logger.error(message, { ...meta, requestId });
        },
        warn: (message: string, meta: object = {}) => {
            logger.warn(message, { ...meta, requestId });
        },
        debug: (message: string, meta: object = {}) => {
            logger.debug(message, { ...meta, requestId });
        },
    };
}