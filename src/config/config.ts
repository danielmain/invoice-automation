import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config();

export interface AppConfig {
    server: {
        port: number;
        environment: string;
    };
    encryptionKey: string;
    browser: {
        headless: boolean;
        timeout: number;
        useSystemBrowser: boolean;
    };
    storage: {
        invoicePath: string;
    };
}

// Function to get boolean from environment variable
function getBooleanEnv(name: string, defaultValue: boolean): boolean {
    const value = process.env[name];
    if (value === undefined) return defaultValue;
    return value.toLowerCase() === 'true';
}

// Function to get number from environment variable
function getNumberEnv(name: string, defaultValue: number): number {
    const value = process.env[name];
    if (value === undefined) return defaultValue;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
}

// Configuration object
export const config: AppConfig = {
    server: {
        port: getNumberEnv('PORT', 3000),
        environment: process.env.NODE_ENV || 'development',
    },
    encryptionKey: process.env.ENCRYPTION_KEY || 'default-encryption-key-change-me',
    browser: {
        headless: getBooleanEnv('HEADLESS', true),
        timeout: getNumberEnv('BROWSER_TIMEOUT', 30000),
        useSystemBrowser: getBooleanEnv('USE_SYSTEM_BROWSER', true),
    },
    storage: {
        invoicePath: process.env.INVOICE_STORAGE_PATH || path.join(process.cwd(), 'invoices'),
    },
};

// Validate critical configuration
if (config.encryptionKey === 'default-encryption-key-change-me' && config.server.environment === 'production') {
    console.error('WARNING: Using default encryption key in production is insecure!');
    console.error('Please set a secure ENCRYPTION_KEY in your environment variables.');
}