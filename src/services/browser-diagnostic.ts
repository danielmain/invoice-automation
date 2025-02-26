import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { logger } from '../utils/logger';
import { chromium } from 'playwright';

/**
 * Run diagnostic checks to troubleshoot browser issues
 * This can be called before browser initialization to identify environment issues
 */
export async function runBrowserDiagnostics(): Promise<void> {
    logger.info('======= BROWSER ENVIRONMENT DIAGNOSTICS =======');

    // System information
    logger.info(`Platform: ${process.platform} ${process.arch}`);
    logger.info(`Node.js version: ${process.version}`);
    logger.info(`User home directory: ${os.homedir()}`);
    logger.info(`Current working directory: ${process.cwd()}`);

    // Directory permissions
    const directoriesToCheck = [
        process.cwd(),
        path.join(process.cwd(), 'profiles'),
        path.join(process.cwd(), 'logs'),
        os.tmpdir()
    ];

    logger.info('Checking directory permissions:');
    for (const dir of directoriesToCheck) {
        try {
            await fs.access(dir, fs.constants.R_OK | fs.constants.W_OK);
            const stats = await fs.stat(dir);
            logger.info(`- ${dir}: ${stats.mode.toString(8)} (read/write: OK)`);
        } catch (error) {
            logger.error(`- ${dir}: Permission error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    // Chromium executable
    logger.info('Checking Playwright browser installation:');
    try {
        const executablePath = chromium.executablePath();
        logger.info(`- Chromium executable: ${executablePath}`);

        try {
            const stats = await fs.stat(executablePath);
            logger.info(`- Executable exists: Yes (${stats.size} bytes)`);

            // Check if executable
            const mode = stats.mode.toString(8);
            const isExecutable = (stats.mode & fs.constants.X_OK) !== 0;
            logger.info(`- Executable permissions: ${mode} (can execute: ${isExecutable ? 'Yes' : 'No'})`);
        } catch (error) {
            logger.error(`- Cannot access executable: ${error instanceof Error ? error.message : String(error)}`);
        }
    } catch (error) {
        logger.error(`- Failed to get Chromium executable path: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Environment variables
    logger.info('Checking relevant environment variables:');
    const relevantVars = [
        'PLAYWRIGHT_BROWSERS_PATH',
        'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD',
        'CHROME_PATH',
        'HEADLESS',
        'DISPLAY',  // Important for Linux X11
        'XAUTHORITY' // Important for Linux X11
    ];

    for (const varName of relevantVars) {
        logger.info(`- ${varName}: ${process.env[varName] || '(not set)'}`);
    }

    // System resources
    logger.info('System resources:');
    logger.info(`- Total memory: ${Math.round(os.totalmem() / (1024 * 1024))} MB`);
    logger.info(`- Free memory: ${Math.round(os.freemem() / (1024 * 1024))} MB`);
    logger.info(`- CPUs: ${os.cpus().length}`);

    // Try minimal browser launch
    logger.info('Attempting minimal browser launch test:');
    try {
        // Launch with minimal options to see if it even works
        const browser = await chromium.launch({
            headless: true,
            timeout: 10000,
            args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-setuid-sandbox']
        }).catch(e => {
            logger.error(`- Launch error: ${e instanceof Error ? e.message : String(e)}`);
            return null;
        });

        if (browser) {
            logger.info('- Browser launched successfully');
            logger.info(`- Browser version: ${await browser.version()}`);
            await browser.close();
            logger.info('- Browser closed successfully');
        } else {
            logger.error('- Browser launch failed');
        }
    } catch (error) {
        logger.error(`- Diagnostic browser launch failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    logger.info('===============================================');
}