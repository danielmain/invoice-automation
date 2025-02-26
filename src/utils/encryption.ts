import CryptoJS from 'crypto-js';
import { config } from '../config/config';
import { logger } from '../utils/logger';

// Constants
const ENCRYPTION_KEY = config.encryptionKey;

/**
 * Encrypt a string using AES encryption
 * @param plainText The string to encrypt
 * @returns The encrypted string
 */
export function encrypt(plainText: string, key: string = ENCRYPTION_KEY): string {
    try {
        return CryptoJS.AES.encrypt(plainText, key).toString();
    } catch (error) {
        logger.error('Encryption failed', { error });
        throw new Error('Failed to encrypt data');
    }
}

/**
 * Decrypt an encrypted string using AES encryption
 * @param encryptedText The encrypted string
 * @returns The decrypted string
 */
export function decrypt(encryptedText: string, key: string = ENCRYPTION_KEY): string {
    try {
        const bytes = CryptoJS.AES.decrypt(encryptedText, key);
        return bytes.toString(CryptoJS.enc.Utf8);
    } catch (error) {
        logger.error('Decryption failed', { error });
        throw new Error('Failed to decrypt data');
    }
}

/**
 * Encrypt an object using AES encryption
 * @param data The object to encrypt
 * @returns The encrypted string
 */
export function encryptObject(data: object, key: string = ENCRYPTION_KEY): string {
    return encrypt(JSON.stringify(data), key);
}

/**
 * Decrypt an encrypted string and parse it as JSON
 * @param encryptedText The encrypted string
 * @returns The decrypted object
 */
export function decryptObject<T>(encryptedText: string, key: string = ENCRYPTION_KEY): T {
    const decrypted = decrypt(encryptedText, key);
    try {
        return JSON.parse(decrypted) as T;
    } catch (error) {
        logger.error('Failed to parse decrypted JSON', { error });
        throw new Error('Invalid encrypted data format');
    }
}

/**
 * Generate a hash of a string using SHA-256
 * @param data The string to hash
 * @returns The hashed string
 */
export function hash(data: string): string {
    return CryptoJS.SHA256(data).toString();
}