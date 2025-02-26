import fs from 'fs/promises';
import path from 'path';
import CryptoJS from 'crypto-js';
import { config } from '../config/config';
import { logger } from '../utils/logger';

// Type definitions
export type Credential = {
    username: string;
    password: string;
    additionalFields?: Record<string, string>;
    lastUpdated: Date;
};

export type VendorCredentials = Record<string, Credential>;

// Constants
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');
const ENCRYPTION_KEY = config.encryptionKey;

// Pure functions for encryption/decryption
const encrypt = (data: string): string =>
    CryptoJS.AES.encrypt(data, ENCRYPTION_KEY).toString();

const decrypt = (encryptedData: string): string => {
    const bytes = CryptoJS.AES.decrypt(encryptedData, ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
};

// Core functions
export async function initializeCredentialStore(): Promise<void> {
    try {
        await fs.access(CREDENTIALS_PATH);
        logger.info('Credentials file exists');
    } catch (error) {
        logger.info('Creating credentials file');
        await fs.writeFile(CREDENTIALS_PATH, encrypt(JSON.stringify({})));
    }
}

export async function getAllCredentials(): Promise<VendorCredentials> {
    try {
        const data = await fs.readFile(CREDENTIALS_PATH, 'utf-8');
        return JSON.parse(decrypt(data));
    } catch (error) {
        logger.error('Error reading credentials file', { error });
        return {};
    }
}

export async function getCredential(vendorId: string): Promise<Credential | null> {
    const allCredentials = await getAllCredentials();
    return allCredentials[vendorId] || null;
}

export async function storeCredential(vendorId: string, credential: Omit<Credential, 'lastUpdated'>): Promise<void> {
    const allCredentials = await getAllCredentials();

    const updatedCredentials = {
        ...allCredentials,
        [vendorId]: {
            ...credential,
            lastUpdated: new Date()
        }
    };

    await fs.writeFile(
        CREDENTIALS_PATH,
        encrypt(JSON.stringify(updatedCredentials))
    );

    logger.info(`Credentials stored for vendor: ${vendorId}`);
}

export async function removeCredential(vendorId: string): Promise<void> {
    const allCredentials = await getAllCredentials();

    if (allCredentials[vendorId]) {
        const { [vendorId]: _, ...remainingCredentials } = allCredentials;

        await fs.writeFile(
            CREDENTIALS_PATH,
            encrypt(JSON.stringify(remainingCredentials))
        );

        logger.info(`Credentials removed for vendor: ${vendorId}`);
    }
}