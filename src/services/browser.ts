import { firefox, Browser, BrowserContext, Page } from 'playwright';
import path from 'path';
import fs from 'fs/promises';
import { config } from '../config/config';
import { logger } from '../utils/logger';

// Type definitions
export type BrowserOptions = {
    headless?: boolean;
    profileName?: string;
    timeout?: number;
    debugMode?: boolean;
};

// Constants
const PROFILES_DIR = path.join(process.cwd(), 'profiles');

// State container (minimized and encapsulated)
const browserState = {
    browser: null as Browser | null,
    context: null as BrowserContext | null
};

// Core functions
export async function initializeBrowser(): Promise<void> {
    try {
        logger.info('Initializing browser service');

        // Check for Playwright binaries
        logger.info('Checking for Playwright installation');

        try {
            // This is hacky but helps identify if Playwright is available
            // @ts-ignore
            const chromiumInfo = await firefox.executablePath().catch(e => 'not found');
            logger.info(`Chromium executable path: ${chromiumInfo}`);
        } catch (chromiumError) {
            logger.warn('Could not retrieve Chromium executable path', { error: chromiumError });
        }

        // Create profiles directory
        logger.info(`Creating browser profiles directory at: ${PROFILES_DIR}`);
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
                permissions: process.platform === 'win32' ? 'N/A' : await fs.stat(path.dirname(PROFILES_DIR)).catch(() => ({ mode: 'unknown' }))
            });
            throw error;
        }

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

export async function launchBrowser(options: BrowserOptions = {}): Promise<Browser> {
    const headless = false;
    //options.headless ?? config.browser.headless;
    const timeout = options.timeout ?? config.browser.timeout;

    try {
        // Launch browser
        const browser = await firefox.launch();

        // Update state
        browserState.browser = browser;
        logger.info('Browser launched successfully');

        return browser;
    } catch (error) {
        console.dir(error);
        logger.error('Failed to launch browser', { error });
        throw error;
    }
}

export async function createBrowserContext(options: BrowserOptions = {}): Promise<BrowserContext> {
    if (!browserState.browser) {
        await launchBrowser(options);
    }

    try {
        let context: BrowserContext;

        if (options.profileName) {
            // Use a persistent context with user profile
            const userDataDir = path.join(PROFILES_DIR, options.profileName);
            await fs.mkdir(userDataDir, { recursive: true });

            context = await firefox.launchPersistentContext(userDataDir, {
                headless: options.headless ?? config.browser.headless,
                timeout: options.timeout ?? config.browser.timeout
            });
            logger.info(`Created persistent context with profile: ${options.profileName}`);
        } else {
            // Use a regular context
            context = await browserState.browser!.newContext();
            logger.info('Created new browser context');
        }

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
        logger.error('Failed to create browser context', { error });
        throw error;
    }
}

export async function createPage(): Promise<Page> {
    if (!browserState.context) {
        await createBrowserContext();
    }

    return browserState.context!.newPage();
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
    const browser = browserState.context?.browser();
    if (browserState.context && browser && !browser.isConnected()) {
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