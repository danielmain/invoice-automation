import crypto from 'crypto';
import { logger } from './logger';

/**
 * Generate a TOTP (Time-based One-Time Password) code
 *
 * @param secret The secret key in base32 format
 * @param timeStep Time step in seconds (default 30)
 * @param digits Number of digits in the code (default 6)
 * @param timestamp Current timestamp (default to current time)
 * @returns The generated TOTP code
 */
export function generateTOTP(
    secret: string,
    timeStep: number = 30,
    digits: number = 6,
    timestamp: number = Date.now()
): string {
    try {
        // Convert the base32 secret to a buffer
        const cleanedSecret = secret.replace(/\s+/g, '').toUpperCase();
        const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

        // Decode base32 secret to binary
        let buffer = Buffer.alloc(Math.ceil(cleanedSecret.length * 5 / 8));
        let bits = 0;
        let value = 0;
        let index = 0;

        for (let i = 0; i < cleanedSecret.length; i++) {
            const charValue = base32Chars.indexOf(cleanedSecret[i]);
            if (charValue === -1) continue; // Skip invalid characters

            value = (value << 5) | charValue;
            bits += 5;

            if (bits >= 8) {
                buffer[index++] = (value >> (bits - 8)) & 0xff;
                bits -= 8;
            }
        }

        // Calculate the TOTP counter value from the current time
        const counter = Math.floor(timestamp / 1000 / timeStep);

        // Create buffer from counter (64-bit big-endian)
        const counterBuffer = Buffer.alloc(8);
        for (let i = 0; i < 8; i++) {
            counterBuffer[7 - i] = counter & (0xff << (i * 8)) >> (i * 8);
        }

        // Calculate HMAC using SHA-1
        const hmac = crypto.createHmac('sha1', buffer);
        const hmacResult = hmac.update(counterBuffer).digest();

        // Dynamic truncation
        const offset = hmacResult[hmacResult.length - 1] & 0xf;

        // Get 4 bytes starting at the offset
        const binary =
            ((hmacResult[offset] & 0x7f) << 24) |
            ((hmacResult[offset + 1] & 0xff) << 16) |
            ((hmacResult[offset + 2] & 0xff) << 8) |
            (hmacResult[offset + 3] & 0xff);

        // Generate the TOTP code with the specified number of digits
        const code = binary % Math.pow(10, digits);

        // Pad the code with leading zeros if necessary
        return code.toString().padStart(digits, '0');
    } catch (error) {
        logger.error('Error generating TOTP code', { error });
        throw new Error('Failed to generate TOTP code');
    }
}

/**
 * Validate that a TOTP secret is in the correct format
 *
 * @param secret The secret to validate
 * @returns Whether the secret is valid
 */
export function isValidTOTPSecret(secret: string): boolean {
    // Remove spaces and convert to uppercase
    const cleanedSecret = secret.replace(/\s+/g, '').toUpperCase();

    // Check that it contains only valid base32 characters
    const base32Regex = /^[A-Z2-7]+$/;

    // Most TOTP secrets are at least 16 characters (80 bits)
    return base32Regex.test(cleanedSecret) && cleanedSecret.length >= 16;
}

/**
 * Generate a time window of valid TOTP codes
 * Useful for handling clock skew between client and server
 *
 * @param secret The secret key in base32 format
 * @param window Number of time steps to check before and after the current time
 * @returns Array of valid TOTP codes
 */
export function generateTOTPWindow(
    secret: string,
    window: number = 1
): string[] {
    const now = Date.now();
    const timeStep = 30;
    const digits = 6;
    const codes: string[] = [];

    // Generate codes for the current and adjacent time windows
    for (let i = -window; i <= window; i++) {
        const timestamp = now + (i * timeStep * 1000);
        codes.push(generateTOTP(secret, timeStep, digits, timestamp));
    }

    return codes;
}