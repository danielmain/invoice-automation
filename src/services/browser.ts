import { chromium, Browser, BrowserContext, Page } from 'playwright';
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
    useSystemBrowser?: boolean;
};

// Cookie and storage state types
interface Cookie {
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: string;
}

interface StorageState {
    cookies: Cookie[];
    origins: Record<string, any>;
}

// Constants
const PROFILES_DIR = path.join(process.cwd(), 'profiles');

// State container
const browserState = {
    browser: null as Browser | null,
    context: null as BrowserContext | null,
    currentProfileName: null as string | null
};

// Core functions
export async function initializeBrowser(): Promise<void> {
    try {
        logger.info('Initializing browser service');

        // Create profiles directory if it doesn't exist
        try {
            const dirStat = await fs.stat(PROFILES_DIR).catch(() => null);
            if (dirStat && dirStat.isDirectory()) {
                logger.info('Browser profiles directory already exists');

                // DEBUG: List existing profiles
                const profiles = await fs.readdir(PROFILES_DIR);
                logger.info(`Found ${profiles.length} profiles: ${profiles.join(', ')}`);

                // Check each profile directory
                for (const profile of profiles) {
                    const profilePath = path.join(PROFILES_DIR, profile);
                    const stats = await fs.stat(profilePath);
                    if (stats.isDirectory()) {
                        try {
                            const files = await fs.readdir(profilePath);
                            logger.info(`Profile ${profile} contains: ${files.join(', ')}`);

                            // Check storage state file if it exists
                            const storageFile = path.join(profilePath, 'storage-state.json');
                            try {
                                const storageStats = await fs.stat(storageFile);
                                logger.info(`Storage state file for ${profile} exists (${storageStats.size} bytes)`);

                                // DEBUG: Read and log cookies count
                                const storageContent = await fs.readFile(storageFile, 'utf8');
                                const storage = JSON.parse(storageContent) as StorageState;
                                const cookiesCount = storage.cookies ? storage.cookies.length : 0;
                                const originsCount = storage.origins ? Object.keys(storage.origins).length : 0;
                                logger.info(`Storage contains ${cookiesCount} cookies and ${originsCount} origins`);
                            } catch (err) {
                                logger.info(`No storage state file found for profile ${profile}`);
                            }
                        } catch (err) {
                            logger.error(`Error reading profile ${profile}: ${err}`);
                        }
                    }
                }
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

async function loadStorageState(profileName: string): Promise<string | undefined> {
    const storageStatePath = path.join(PROFILES_DIR, profileName, 'storage-state.json');

    try {
        // Check if file exists
        await fs.access(storageStatePath);

        // Read the file content
        const content = await fs.readFile(storageStatePath, 'utf8');
        const storage = JSON.parse(content) as StorageState;

        // Log storage details
        const cookiesCount = storage.cookies ? storage.cookies.length : 0;
        const domains = storage.cookies ? [...new Set(storage.cookies.map((c: Cookie) => c.domain))].join(', ') : '';
        logger.info(`Loaded storage state for profile ${profileName}: ${cookiesCount} cookies for domains: ${domains}`);

        return storageStatePath;
    } catch (err) {
        logger.info(`No usable storage state for profile ${profileName}: ${err}`);
        return undefined;
    }
}

export async function launchBrowser(options: BrowserOptions = {}): Promise<Browser> {
    const headless = options.headless ?? config.browser.headless;
    const timeout = options.timeout ?? config.browser.timeout;

    try {
        logger.info('Launching Chromium browser');
        const browser = await chromium.launch({
            headless,
            timeout,
            args: [
                '--disable-dev-shm-usage',
                '--no-first-run',
                '--no-default-browser-check'
            ]
        });

        logger.info('Browser launched successfully');
        browserState.browser = browser;
        return browser;
    } catch (error) {
        logger.error('Failed to launch browser', {
            error: error instanceof Error ? error.message : String(error)
        });
        throw error;
    }
}

export async function createBrowserContext(options: BrowserOptions = {}): Promise<BrowserContext> {
    logger.info('Creating browser context');

    // Save the current profile name
    const profileName = options.profileName ?? 'default-profile';
    browserState.currentProfileName = profileName;

    logger.info(`Using profile: ${profileName}`);

    // Create profile directory if it doesn't exist
    const profileDir = path.join(PROFILES_DIR, profileName);
    await fs.mkdir(profileDir, { recursive: true }).catch(() => {});

    if (!browserState.browser) {
        logger.info('Browser not initialized, launching browser first');
        await launchBrowser(options);
    }

    try {
        // Make sure we have a browser instance
        if (!browserState.browser) {
            throw new Error('Browser instance still null after launch attempt');
        }

        logger.info(`Loading storage state for profile: ${profileName}`);
        const storageState = await loadStorageState(profileName);

        // Create browser context options
        const contextOptions: any = {};
        if (storageState) {
            contextOptions.storageState = storageState;
        }

        // Add debugging if requested
        if (options.debugMode) {
            logger.info('Debug mode enabled for browser context');
            contextOptions.logger = {
                isEnabled: (name: string, severity: string) => severity === 'verbose',
                log: (name: string, severity: string, message: string, args: any) => {
                    logger.debug(`[Browser ${name}] ${message}`);
                }
            };
        }

        // Create the browser context
        logger.info(`Creating new browser context with options: ${JSON.stringify(contextOptions)}`);
        const context = await browserState.browser.newContext(contextOptions);
        logger.info('Created new browser context successfully');

        // Set up debugging if enabled
        if (options.debugMode) {
            context.on('page', page => {
                page.on('console', message => {
                    logger.debug(`Browser console [${message.type()}]: ${message.text()}`);
                });
                page.on('request', request => {
                    logger.debug(`Request: ${request.method()} ${request.url()}`);
                });
                page.on('response', response => {
                    logger.debug(`Response: ${response.status()} ${response.url()}`);
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

export async function waitForUserLogin(page: Page, targetUrl: string): Promise<boolean> {
    try {
        logger.info(`Navigating to target URL: ${targetUrl}`);

        // Navigate to the target URL (Amazon order history in this case)
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

        // Log current URL for debugging
        logger.info(`Current URL after navigation: ${page.url()}`);

        // Check if we're already at the target URL (already logged in)
        if (page.url() === targetUrl || page.url().includes('order-history')) {
            logger.info('Already logged in - reached target URL directly');
            await saveProfileState();
            return true;
        }

        // If we're redirected to a login page
        logger.info(`Redirected to login page: ${page.url()}`);
        logger.info('===========================================');
        logger.info('LOGIN REQUIRED: Please log in using the browser window');
        logger.info('The application will wait until you complete the login');
        logger.info('The window will stay open until you finish the login process');
        logger.info('===========================================');

        // Wait for navigation to the target URL or a URL containing order-history
        // This is the definitive indication that login is complete
        try {
            // Create a Promise that resolves when we navigate to the target URL
            await new Promise<void>((resolve, reject) => {
                // Function to check URL
                const checkUrl = async () => {
                    const currentUrl = page.url();
                    logger.info(`Checking URL: ${currentUrl}`);
                    if (currentUrl === targetUrl || currentUrl.includes('order-history')) {
                        logger.info(`Successfully navigated to target URL: ${currentUrl}`);
                        resolve();
                    }
                };

                // Set up a listener for navigation events
                page.on('framenavigated', async (frame) => {
                    if (frame === page.mainFrame()) {
                        logger.info(`Frame navigated to: ${frame.url()}`);
                        await checkUrl();
                    }
                });

                // Also set up a polling interval as a backup
                const interval = setInterval(async () => {
                    await checkUrl();
                }, 1000);

                // Clear interval when promise resolves
                const clearResources = () => {
                    clearInterval(interval);
                };

                // Set up resolve/reject handlers to clean up resources
                page.once('close', () => {
                    clearResources();
                    reject(new Error('Page was closed before login completed'));
                });
            });

            // Additional waiting for any final redirects
            await page.waitForLoadState('networkidle');

            logger.info('Login successful! Target URL reached.');

            // Save cookies/storage after successful login
            await saveProfileState();

            return true;
        } catch (error) {
            logger.error(`Error waiting for login completion: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    } catch (error) {
        logger.error(`Error in waitForUserLogin: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}

async function saveProfileState(): Promise<void> {
    if (!browserState.context || !browserState.currentProfileName) {
        logger.warn('Cannot save profile state: No active browser context or profile name');
        return;
    }

    try {
        const profileDir = path.join(PROFILES_DIR, browserState.currentProfileName);
        const storageStatePath = path.join(profileDir, 'storage-state.json');

        // Ensure directory exists
        await fs.mkdir(profileDir, { recursive: true }).catch(() => {});

        // Save the storage state to the profile directory
        logger.info(`Saving storage state to: ${storageStatePath}`);
        await browserState.context.storageState({ path: storageStatePath });

        // Validate the storage state was saved properly
        try {
            const stats = await fs.stat(storageStatePath);
            logger.info(`Storage state file created (${stats.size} bytes)`);

            // Read and log some info about saved state
            const storageData = await fs.readFile(storageStatePath, 'utf8');
            const storage = JSON.parse(storageData) as StorageState;
            const cookiesCount = storage.cookies ? storage.cookies.length : 0;
            const domains = storage.cookies ? [...new Set(storage.cookies.map((c: Cookie) => c.domain))].join(', ') : '';

            logger.info(`Saved ${cookiesCount} cookies for domains: ${domains}`);
            logger.info(`Storage state saved successfully for profile: ${browserState.currentProfileName}`);
        } catch (err) {
            logger.error(`Failed to verify storage state file: ${err instanceof Error ? err.message : String(err)}`);
        }
    } catch (error) {
        logger.error(`Failed to save profile state: ${error instanceof Error ? error.message : String(error)}`);
    }
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
    try {
        // Save state before closing
        if (browserState.context) {
            await saveProfileState();
            await browserState.context.close();
            browserState.context = null;
            logger.info('Browser context closed');
        }

        if (browserState.browser) {
            await browserState.browser.close();
            browserState.browser = null;
            logger.info('Browser closed');
        }
    } catch (error) {
        logger.error(`Error closing browser: ${error instanceof Error ? error.message : String(error)}`);
    }
}