import { chromium, Browser, BrowserContext, Page } from 'playwright';
import path from 'path';
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

// State container (minimized and encapsulated)
const browserState = {
    browser: null as Browser | null,
    context: null as BrowserContext | null
};

// Function to detect default browser on the system
const detectDefaultBrowser = async (): Promise<string> => {
    try {
        logger.info('Detecting default browser');

        // On Windows, first check if Chrome or Edge are available
        if (process.platform === 'win32') {
            try {
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
            } catch (error) {
                logger.info('Error checking browser executables, falling back to registry check');
            }

            // Registry check fallback
            try {
                const { stdout } = await execAsync('reg query HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice /v ProgId');
                if (stdout.includes('ChromeHTML')) {
                    logger.info('Chrome detected as default browser from registry');
                    return 'chrome';
                }
                if (stdout.includes('MSEdgeHTM')) {
                    logger.info('Microsoft Edge detected as default browser from registry');
                    return 'msedge';
                }
                if (stdout.includes('Firefox')) return 'firefox';
            } catch (regError) {
                logger.warn(`Registry check failed: ${regError instanceof Error ? regError.message : String(regError)}`);
            }
        }

        // macOS detection
        else if (process.platform === 'darwin') {
            try {
                // Try Chrome first
                const chromeResult = await execAsync('ls /Applications/Google\\ Chrome.app')
                    .then(() => true)
                    .catch(() => false);

                if (chromeResult) {
                    logger.info('Chrome detected on macOS');
                    return 'chrome';
                }

                // Then try Edge
                const edgeResult = await execAsync('ls /Applications/Microsoft\\ Edge.app')
                    .then(() => true)
                    .catch(() => false);

                if (edgeResult) {
                    logger.info('Microsoft Edge detected on macOS');
                    return 'msedge';
                }
            } catch (error) {
                logger.info('Error checking browser executables on macOS');
            }
        }

        // Linux detection
        else {
            try {
                const chromeResult = await execAsync('which google-chrome')
                    .then(() => true)
                    .catch(() => false);

                if (chromeResult) {
                    logger.info('Chrome detected on Linux');
                    return 'chrome';
                }

                const edgeResult = await execAsync('which microsoft-edge')
                    .then(() => true)
                    .catch(() => false);

                if (edgeResult) {
                    logger.info('Microsoft Edge detected on Linux');
                    return 'msedge';
                }
            } catch (error) {
                logger.info('Error checking browser executables on Linux');
            }
        }

        // Default to Chrome if we couldn't detect - it's the most likely to work with CDP
        logger.info('Could not determine browser, defaulting to Chrome');
        return 'chrome';
    } catch (error) {
        logger.warn(`Could not detect default browser: ${error instanceof Error ? error.message : String(error)}`);
        return 'chrome'; // Default to Chrome
    }
};

// Function to launch default browser with debugging
const launchDefaultBrowser = async (browserName: string): Promise<void> => {
    try {
        // Launch with remote debugging port
        const debugPort = 9222;
        const url = 'about:blank';

        logger.info(`Launching ${browserName} with remote debugging port ${debugPort}`);

        // Close any existing browser instances that might be using the port
        try {
            if (process.platform === 'win32') {
                // On Windows, try to kill any existing processes using the port
                await execAsync('taskkill /f /im chrome.exe').catch(() => {});
                await execAsync('taskkill /f /im msedge.exe').catch(() => {});
            } else if (process.platform === 'darwin') {
                // On macOS, try to kill processes
                await execAsync('pkill -f "Google Chrome"').catch(() => {});
                await execAsync('pkill -f "Microsoft Edge"').catch(() => {});
            } else {
                // On Linux
                await execAsync('pkill -f chrome').catch(() => {});
                await execAsync('pkill -f msedge').catch(() => {});
            }
            logger.info('Closed any existing browser instances');
        } catch (killError) {
            // Ignore errors from process killing
            logger.info('Note: No existing browser processes needed to be closed');
        }

        // Now launch the browser with debugging enabled - explicitly avoiding private/incognito mode
        let command = '';
        if (process.platform === 'win32') {
            // On Windows
            if (browserName.includes('chrome')) {
                command = `start chrome --remote-debugging-port=${debugPort} --no-first-run --no-default-browser-check --disable-features=InPrivate ${url}`;
            } else if (browserName.includes('edge') || browserName === 'msedge') {
                command = `start msedge --remote-debugging-port=${debugPort} --no-first-run --no-default-browser-check --disable-features=InPrivate ${url}`;
            } else {
                command = `start ${browserName} ${url}`;
            }
        } else if (process.platform === 'darwin') {
            // On macOS
            if (browserName.includes('chrome')) {
                command = `open -a "Google Chrome" --args --remote-debugging-port=${debugPort} --no-first-run --profile-directory=Default ${url}`;
            } else if (browserName.includes('edge')) {
                command = `open -a "Microsoft Edge" --args --remote-debugging-port=${debugPort} --no-first-run --profile-directory=Default ${url}`;
            } else {
                command = `open -a "${browserName}" ${url}`;
            }
        } else {
            // On Linux
            if (browserName.includes('chrome')) {
                command = `google-chrome --remote-debugging-port=${debugPort} --no-first-run --profile-directory=Default ${url}`;
            } else if (browserName.includes('edge')) {
                command = `microsoft-edge --remote-debugging-port=${debugPort} --no-first-run --profile-directory=Default ${url}`;
            } else {
                command = `${browserName} ${url}`;
            }
        }

        logger.info(`Executing browser launch command: ${command}`);
        await execAsync(command);

        logger.info(`Browser ${browserName} launched with debugging port ${debugPort}`);
    } catch (error) {
        logger.error(`Failed to launch system browser: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
};

// Find Chrome debugging port
const findChromeDebuggingPort = async (): Promise<number | null> => {
    try {
        // Standard Chrome debugging port
        return 9222;
    } catch (error) {
        logger.error(`Failed to find Chrome debugging port: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
};

// Core functions
export async function initializeBrowser(): Promise<void> {
    try {
        logger.info('Initializing browser service');

        // Check for Playwright binaries
        logger.info('Checking for Playwright installation');

        try {
            // This is hacky but helps identify if Playwright is available
            const chromiumInfo = await chromium.executablePath();
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

export async function launchBrowser(options: BrowserOptions = {}): Promise<Browser> {
    const headless = options.headless ?? config.browser.headless;
    const timeout = options.timeout ?? config.browser.timeout;
    const useSystemBrowser = options.useSystemBrowser ?? config.browser.useSystemBrowser;

    try {
        logger.info(`Attempting to launch browser - headless: ${headless}, useSystemBrowser: ${useSystemBrowser}`);

        if (useSystemBrowser && !headless) {
            try {
                // Launch system browser and connect over CDP
                const defaultBrowser = await detectDefaultBrowser();
                logger.info(`Launching system browser: ${defaultBrowser}`);

                // Launch the browser with debugging enabled
                await launchDefaultBrowser(defaultBrowser);

                // Give it some time to start
                logger.info("Waiting for browser to initialize with debugging port...");
                await new Promise(resolve => setTimeout(resolve, 3000));

                // Find the debugging port
                const debuggingPort = 9222; // We use a fixed port for simplicity

                // Try to connect to the browser
                logger.info(`Connecting to system browser on port ${debuggingPort}`);

                try {
                    const browser = await chromium.connectOverCDP(`http://localhost:${debuggingPort}`);
                    logger.info('Connected to system browser successfully');
                    browserState.browser = browser;
                    return browser;
                } catch (connectError) {
                    logger.error(`Failed to connect to browser on port ${debuggingPort}: ${connectError instanceof Error ? connectError.message : String(connectError)}`);
                    throw connectError;
                }
            } catch (systemBrowserError) {
                // If system browser approach fails, fall back to Playwright's managed browser
                logger.warn(`System browser approach failed, falling back to Playwright managed browser: ${systemBrowserError instanceof Error ? systemBrowserError.message : String(systemBrowserError)}`);
            }

            // Use Playwright's managed browser as fallback
            logger.info('Launching Playwright managed browser as fallback');
            try {
                const browser = await chromium.launch({
                    headless: false, // Force visible since system browser was requested
                    timeout,
                    args: [
                        '--disable-dev-shm-usage',
                        '--profile-directory=Default', // Use default profile
                        '--no-incognito',
                        '--no-first-run',
                        '--no-default-browser-check'
                    ]
                });

                logger.info('Managed browser launched successfully as fallback');
                browserState.browser = browser;
                return browser;
            } catch (fallbackError) {
                logger.error(`Managed browser fallback failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
                throw fallbackError;
            }
        } else {
            // Use Playwright's managed browser
            logger.info('Launching managed Playwright browser');
            const browser = await chromium.launch({
                headless,
                timeout,
                args: ['--disable-dev-shm-usage']
            });

            logger.info('Browser launched successfully');
            browserState.browser = browser;
            return browser;
        }
    } catch (error) {
        logger.error('Failed to launch browser', { error });

        // Last resort fallback - try with a plain browser launch
        try {
            logger.info('Attempting emergency fallback browser launch');
            const browser = await chromium.launch({
                headless: false,
                timeout,
                args: [
                    '--disable-dev-shm-usage',
                    '--profile-directory=Default',
                    '--no-startup-window',
                    '--no-incognito',
                    '--no-first-run'
                ]
            });
            logger.info('Emergency fallback browser launched successfully');
            browserState.browser = browser;
            return browser;
        } catch (fallbackError) {
            logger.error('Even fallback browser launch failed', { fallbackError });
            throw error; // Throw the original error
        }
    }
}

export async function createBrowserContext(options: BrowserOptions = {}): Promise<BrowserContext> {
    logger.info('Creating browser context');

    if (!browserState.browser) {
        await launchBrowser(options);
    }

    try {
        let context: BrowserContext;

        // Use a regular context since we're already using the system browser
        context = await browserState.browser!.newContext();
        logger.info('Created new browser context');

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