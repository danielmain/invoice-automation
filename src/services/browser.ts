import { chromium, Browser, BrowserContext, Page } from 'playwright';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { config } from '../config/config';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

// Type definitions
export type BrowserOptions = {
    headless?: boolean;
    profileName?: string;
    timeout?: number;
    debugMode?: boolean;
    useSystemBrowser?: boolean;
};

// Constants
const PROFILES_DIR = path.join(process.cwd(), 'profiles');

// State container
const browserState = {
    browser: null as Browser | null,
    context: null as BrowserContext | null
};

// Function to detect default browser on the system
const detectDefaultBrowser = async (): Promise<string> => {
    try {
        logger.info('Detecting default browser');

        // On Windows, check for Edge and Chrome
        if (process.platform === 'win32') {
            try {
                // Check for Edge executable (more likely to exist on Windows)
                const edgeExists = await fs.access('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')
                    .then(() => true)
                    .catch(() => fs.access('C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe')
                        .then(() => true)
                        .catch(() => false));

                if (edgeExists) {
                    logger.info('Microsoft Edge detected on the system');
                    return 'msedge';
                }

                // Check for Chrome executable
                const chromeExists = await fs.access('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
                    .then(() => true)
                    .catch(() => fs.access('C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe')
                        .then(() => true)
                        .catch(() => false));

                if (chromeExists) {
                    logger.info('Chrome detected on the system');
                    return 'chrome';
                }
            } catch (error) {
                logger.info('Error checking browser executables');
            }
        }

        // Default to Edge if we couldn't detect - adjust if needed
        logger.info('Using Microsoft Edge as default browser');
        return 'msedge';
    } catch (error) {
        logger.warn(`Could not detect default browser: ${error instanceof Error ? error.message : String(error)}`);
        return 'msedge'; // Default to Edge
    }
};

// Core functions
export async function initializeBrowser(): Promise<void> {
    try {
        logger.info('Initializing browser service');

        // Create profiles directory
        try {
            const dirStat = await fs.stat(PROFILES_DIR).catch(() => null);
            if (dirStat && dirStat.isDirectory()) {
                logger.info('Browser profiles directory already exists');
            } else {
                await fs.mkdir(PROFILES_DIR, { recursive: true });
                logger.info('Browser profiles directory created');
            }
        } catch (error) {
            logger.error('Failed to create profiles directory', {
                error,
                profilesDir: PROFILES_DIR,
            });
            throw error;
        }

        // Detect default browser
        const defaultBrowser = await detectDefaultBrowser();
        logger.info(`Detected default browser: ${defaultBrowser}`);

        logger.info('Browser service initialized successfully');
    } catch (error) {
        logger.error('Failed to initialize browser service', {
            error,
            errorType: error instanceof Error ? error.constructor.name : typeof error,
            errorMessage: error instanceof Error ? error.message : String(error)
        });
        throw error;
    }
}

// Launch system browser with user profile
const launchSystemBrowser = async (browserType: string): Promise<void> => {
    try {
        logger.info(`Launching system browser: ${browserType}`);

        let userDataDir = '';
        let execPath = '';

        // Set paths based on browser type and platform
        if (browserType === 'msedge') {
            userDataDir = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data');
            execPath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
        } else if (browserType === 'chrome') {
            userDataDir = path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
            execPath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
        }

        logger.info(`Using browser path: ${execPath}`);
        logger.info(`Using user data directory: ${userDataDir}`);

        // Simple launch command that opens the browser with the user's profile
        const launchCommand = `"${execPath}" --user-data-dir="${userDataDir}" --profile-directory=Default`;

        // Use spawn to launch browser without blocking
        const { spawn } = require('child_process');
        const proc = spawn('cmd.exe', ['/c', launchCommand], {
            detached: true,
            stdio: 'ignore'
        });
        proc.unref();

        logger.info(`System browser successfully launched with user profile`);
    } catch (error) {
        logger.error(`Failed to launch system browser: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
};

export async function launchBrowser(options: BrowserOptions = {}): Promise<Browser> {
    const headless = options.headless ?? config.browser.headless;
    const timeout = options.timeout ?? config.browser.timeout;
    const profileName = options.profileName ?? 'default-profile';

    try {
        // Create a consistent user data directory for this profile
        const userDataDir = path.join(PROFILES_DIR, profileName);

        // Ensure the directory exists
        await fs.mkdir(userDataDir, { recursive: true });

        logger.info(`Launching browser with persistent context - profile: ${profileName}`);

        // Launch with persistent context to maintain cookies between sessions
        const context = await chromium.launchPersistentContext(userDataDir, {
            headless,
            timeout,
            args: [
                '--disable-dev-shm-usage',
                '--no-first-run',
                '--no-default-browser-check'
            ]
        });

        const browser = context.browser();

        if (!browser) {
            throw new Error('Failed to get browser instance from persistent context');
        }

        logger.info('Browser launched successfully with persistent profile');
        browserState.browser = browser;
        browserState.context = context;

        return browser;
    } catch (error) {
        logger.error('Failed to launch browser', { error });
        throw error;
    }
}

export async function createBrowserContext(options: BrowserOptions = {}): Promise<BrowserContext> {
    logger.info('Creating browser context');

    if (!browserState.browser) {
        logger.info('Browser not initialized, launching browser first');
        await launchBrowser(options);
    }

    try {
        // Make sure we have a browser instance
        if (!browserState.browser) {
            throw new Error('Browser instance still null after launch attempt');
        }

        logger.info('Creating new browser context');
        const context = await browserState.browser.newContext();
        logger.info('Created new browser context successfully');

        // Set up debugging if enabled
        if (options.debugMode) {
            context.on('page', page => {
                page.on('console', message => {
                    logger.debug(`Browser console [${message.type()}]: ${message.text()}`);
                });
            });
        }

        // Update state
        browserState.context = context;
        return context;
    } catch (error) {
        logger.error(`Failed to create browser context: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
}

export async function createPage(): Promise<Page> {
    if (!browserState.context) {
        logger.info('No browser context, initializing new context');
        await createBrowserContext();
    }

    if (!browserState.context) {
        throw new Error('Failed to create browser context');
    }

    logger.info('Creating new page');
    const page = await browserState.context.newPage();
    logger.info('New page created successfully');
    return page;
}

export async function takeScreenshot(page: Page, screenshotPath: string): Promise<void> {
    try {
        // Ensure directory exists
        const dir = path.dirname(screenshotPath);
        await fs.mkdir(dir, { recursive: true });

        // Take screenshot
        await page.screenshot({ path: screenshotPath });
        logger.info(`Screenshot saved to: ${screenshotPath}`);
    } catch (error) {
        logger.error('Failed to take screenshot', { error });
    }
}

export async function closeBrowser(): Promise<void> {
    // Safe browser context closing with null checks
    if (browserState.context) {
        await browserState.context.close();
        browserState.context = null;
        logger.info('Browser context closed');
    }

    if (browserState.browser) {
        await browserState.browser.close();
        browserState.browser = null;
        logger.info('Browser closed');
    }
}