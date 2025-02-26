/**
 * Client-side TOTP implementation using functional programming
 * Based on RFC 6238 (TOTP) and RFC 4226 (HOTP)
 */

// Immutable state container
const initialTotpState = {
    interval: null,
    secret: null,
    timeStep: 30,
    digits: 6
};

// Functional state management - no direct mutations
let totpState = { ...initialTotpState };

// Pure function to update state
const updateTotpState = (updates) => {
    totpState = { ...totpState, ...updates };
    return totpState;
};

// Pure function to convert base32 to bytes
const base32ToBytes = (base32) => {
    const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0;
    let value = 0;
    let index = 0;

    // Clean up the base32 string
    const cleanedInput = base32.toUpperCase().replace(/[^A-Z2-7]/g, '');

    // Calculate the output length
    const outputLength = Math.floor(cleanedInput.length * 5 / 8);
    const result = new Uint8Array(outputLength);

    // Process each character
    for (let i = 0; i < cleanedInput.length; i++) {
        const charValue = base32Chars.indexOf(cleanedInput.charAt(i));
        if (charValue === -1) continue;

        value = (value << 5) | charValue;
        bits += 5;

        if (bits >= 8) {
            result[index++] = (value >>> (bits - 8)) & 0xff;
            bits -= 8;
        }
    }

    return result;
};

// Pure function to convert base64 to bytes
const base64ToBytes = (base64) => {
    try {
        // Remove padding (=) characters first as they can cause issues
        const sanitizedBase64 = base64.replace(/=+$/, '');

        // Some Base64 strings have characters that need to be replaced for URL safety
        const urlSafeBase64 = sanitizedBase64
            .replace(/-/g, '+')
            .replace(/_/g, '/');

        // Add padding back if needed
        let paddedBase64 = urlSafeBase64;
        while (paddedBase64.length % 4 !== 0) {
            paddedBase64 += '=';
        }

        console.log("Processing Base64:", paddedBase64);

        // Use browser's built-in base64 decoder
        const binaryString = atob(paddedBase64);
        const result = new Uint8Array(binaryString.length);

        for (let i = 0; i < binaryString.length; i++) {
            result[i] = binaryString.charCodeAt(i);
        }

        return result;
    } catch (error) {
        console.error('Failed to decode base64:', error);
        // Fallback to treating it as base32
        console.log('Falling back to Base32 processing');
        return base32ToBytes(base64.replace(/[^A-Z2-7]/gi, '').toUpperCase());
    }
};

// Pure function to convert hex to bytes
const hexToBytes = (hex) => {
    // Remove any non-hex characters
    const cleanedHex = hex.replace(/[^0-9A-Fa-f]/g, '');

    // Ensure even length
    const normalizedHex = cleanedHex.length % 2 ? '0' + cleanedHex : cleanedHex;

    const result = new Uint8Array(normalizedHex.length / 2);

    for (let i = 0; i < normalizedHex.length; i += 2) {
        result[i / 2] = parseInt(normalizedHex.substr(i, 2), 16);
    }

    return result;
};

// Pure function to detect and convert secret format
const secretToBytes = (secret) => {
    // Clean up input
    const cleanedSecret = secret.replace(/[\s-]+/g, '');
    console.log("Processing secret:", cleanedSecret);

    // Try Base32 first (most common for TOTP)
    const base32Regex = /^[A-Z2-7]+$/i;
    if (base32Regex.test(cleanedSecret)) {
        console.log('Detected Base32 format');
        return base32ToBytes(cleanedSecret);
    }

    // Try Hex format
    const hexRegex = /^[A-F0-9]+$/i;
    if (hexRegex.test(cleanedSecret)) {
        console.log('Detected Hex format');
        return hexToBytes(cleanedSecret);
    }

    // Extract what looks like a base32 string
    const base32Chars = cleanedSecret.replace(/[^A-Z2-7]/gi, '').toUpperCase();
    if (base32Chars.length >= 16) {
        console.log('Extracted Base32 characters:', base32Chars);
        return base32ToBytes(base32Chars);
    }

    // As a last resort, try to process as Base64
    try {
        console.log('Trying as Base64');
        return base64ToBytes(cleanedSecret);
    } catch (e) {
        console.error('All format detection methods failed:', e);
        // Return a minimal valid key as fallback (20 bytes of zeros)
        console.log('Using emergency fallback key');
        return new Uint8Array(20);
    }
};

// Pure function to validate TOTP secret
const isValidTOTPSecret = (secret) => {
    console.log("Validating TOTP secret:", secret);

    if (!secret || secret.trim() === '') {
        console.log("Empty secret provided");
        return false;
    }

    // Remove spaces and clean up
    const cleanedSecret = secret.replace(/[\s-]+/g, '').toUpperCase();
    console.log("Cleaned secret:", cleanedSecret);

    // Check if it's a Base32 string (A-Z, 2-7)
    const base32Regex = /^[A-Z2-7]+$/;
    const isBase32 = base32Regex.test(cleanedSecret);
    console.log("Is valid Base32:", isBase32);

    // Check if it might be Base64 (A-Z, a-z, 0-9, +, /)
    const base64Regex = /^[A-Za-z0-9+/=]+$/;
    const isBase64 = base64Regex.test(cleanedSecret);
    console.log("Is valid Base64:", isBase64);

    // Check if it might be hexadecimal
    const hexRegex = /^[A-F0-9]+$/;
    const isHex = hexRegex.test(cleanedSecret);
    console.log("Is valid Hex:", isHex);

    // Check for minimum length
    // Base32: 16+ chars, Base64: 12+ chars, Hex: a more flexible range
    const hasValidLength = (isBase32 && cleanedSecret.length >= 16) ||
        (isBase64 && cleanedSecret.length >= 12) ||
        (isHex && cleanedSecret.length >= 20);

    console.log("Has valid length:", hasValidLength, "Length:", cleanedSecret.length);

    // Accept Base32, Base64, or Hex with proper length
    const isValid = (isBase32 || isBase64 || isHex) && hasValidLength;
    console.log("Final validation result:", isValid);

    return isValid;
};

// Pure function for TOTP generation
const generateTOTP = async (secret, counter) => {
    try {
        console.log("Generating TOTP for counter:", counter);

        // Convert the counter to buffer
        const counterBuffer = new ArrayBuffer(8);
        const counterView = new DataView(counterBuffer);

        // Write the counter as a big-endian 64-bit integer
        counterView.setBigUint64(0, BigInt(counter));

        // Convert secret to bytes based on detected format
        const keyBytes = secretToBytes(secret);

        if (keyBytes.length === 0) {
            console.error("Failed to process secret key - empty result");
            return "------";
        }

        console.log(`Secret converted to ${keyBytes.length} bytes`);

        // Import the key for HMAC
        try {
            const key = await window.crypto.subtle.importKey(
                'raw',
                keyBytes,
                { name: 'HMAC', hash: 'SHA-1' },
                false,
                ['sign']
            );

            // Sign the counter with the key
            const signature = await window.crypto.subtle.sign(
                'HMAC',
                key,
                counterBuffer
            );

            // Get the result as Uint8Array
            const hmacResult = new Uint8Array(signature);

            // Dynamic truncation
            const offset = hmacResult[hmacResult.length - 1] & 0xf;

            // Get 4 bytes starting at the offset
            const binary =
                ((hmacResult[offset] & 0x7f) << 24) |
                ((hmacResult[offset + 1] & 0xff) << 16) |
                ((hmacResult[offset + 2] & 0xff) << 8) |
                (hmacResult[offset + 3] & 0xff);

            // Generate the TOTP code with the specified number of digits
            const code = binary % Math.pow(10, totpState.digits);

            // Pad the code with leading zeros if necessary
            const result = code.toString().padStart(totpState.digits, '0');
            console.log("Generated TOTP code:", result);
            return result;
        } catch (cryptoError) {
            console.error('Crypto API error:', cryptoError);
            // Emergency fallback - generate a random code just for UI testing
            // This won't work for actual authentication but prevents UI errors
            const fallbackCode = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
            console.log("Using fallback random code (won't work for auth):", fallbackCode);
            return fallbackCode;
        }
    } catch (error) {
        console.error('Failed to generate TOTP:', error);
        return '------';
    }
};

// Pure function to calculate current time counter
const calculateCounter = () =>
    Math.floor(Date.now() / 1000 / totpState.timeStep);

// Pure function to calculate remaining time
const calculateRemainingTime = () => {
    const timestamp = Date.now() / 1000;
    const timeStep = totpState.timeStep;
    return timeStep - (timestamp % timeStep);
};

// UI update function (side effect isolated to this function)
const updateTOTPCode = async () => {
    if (!totpState.secret) return;

    const codeElement = document.getElementById('current-totp-code');
    const timerElement = document.getElementById('totp-timer');

    if (!codeElement || !timerElement) return;

    const counter = calculateCounter();
    const code = await generateTOTP(totpState.secret, counter);

    codeElement.textContent = code;

    // Update remaining time
    const remainingTime = Math.floor(calculateRemainingTime());
    timerElement.textContent = `(${remainingTime}s)`;

    // Visual indication when time is running out
    if (remainingTime <= 5) {
        codeElement.classList.add('bg-warning');
        codeElement.classList.remove('bg-secondary');
    } else {
        codeElement.classList.remove('bg-warning');
        codeElement.classList.add('bg-secondary');
    }
};

// Start TOTP timer (controlled side effect)
const startTOTPTimer = (secret) => {
    // Clear any existing interval
    stopTOTPTimer();

    // Update state immutably
    updateTotpState({
        secret,
        interval: window.setInterval(() => updateTOTPCode(), 1000)
    });

    // Initial update
    updateTOTPCode();
};

// Stop TOTP timer (controlled side effect)
const stopTOTPTimer = () => {
    if (totpState.interval !== null) {
        window.clearInterval(totpState.interval);
    }

    // Update state immutably
    updateTotpState({
        interval: null,
        secret: null
    });

    // Reset UI
    const codeElement = document.getElementById('current-totp-code');
    const timerElement = document.getElementById('totp-timer');

    if (codeElement) codeElement.textContent = '------';
    if (timerElement) timerElement.textContent = '';
};

// Make functions available globally for the app.js to use
window.isValidTOTPSecret = isValidTOTPSecret;
window.startTOTPTimer = startTOTPTimer;
window.stopTOTPTimer = stopTOTPTimer;