import fs from 'fs';
import { Page } from 'playwright';
import { Credential } from '../services/credential';
import { InvoiceMetadata } from '../services/storage';
import { logger } from '../utils/logger';
import { generateTOTP } from '../utils/totp';
import * as browserService from '../services/browser';
import * as storageService from '../services/storage';

// Type definitions
export type VendorConfig = {
    id: string;
    name: string;
    loginUrl: string;
    invoiceListUrl: string;
    requiresInteraction?: boolean;
    authTimeoutMs?: number;
    downloadTimeoutMs?: number;
};

export type InvoiceData = {
    invoiceNumber: string;
    issueDate: string;
    amount: number;
    currency: string;
    fileBuffer: Buffer;
    additionalData?: Record<string, any>;
};

export type VendorState = {
    config: VendorConfig;
    page: Page | null;
    isLoggedIn: boolean;
};

// Amazon-specific configuration and selectors
export const amazonConfig: VendorConfig = {
    id: 'amazon',
    name: 'Amazon',
    loginUrl: 'https://www.amazon.de/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fwww.amazon.de%2F%3Fref_%3Dnav_custrec_signin&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=deflex&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0',
    invoiceListUrl: 'https://www.amazon.de/-/en/gp/css/order-history?ref_=abn_yadd_ad_your_orders#time/2025/pagination/1/',
    requiresInteraction: false,
    authTimeoutMs: 60000,
    downloadTimeoutMs: 30000,
};

const selectors = {
    loggedInIndicator: '[data-nav-ref="nav_ya_signin"] .nav-line-1-container',
    username: '#ap_email',
    password: '#ap_password',
    continueButton: '#continue',
    signInButton: '#signInSubmit',
    captchaContainer: '#auth-captcha-image-container',
    orderHistoryLink: '#nav-orders',
    orderFilter: '#time-filter',
    orderRows: '#order-card',
    invoiceLink: 'a[href*="invoice"]',
    downloadButton: 'input[name="Download"]',
    // Add more specific selectors as needed
};

// Core functions
export async function initialize(
    headless = true,
    profileName = 'amazon-profile'
): Promise<VendorState> {
    logger.info(`Initializing vendor: ${amazonConfig.name}`);

    // Create browser context with optional profile
    await browserService.createBrowserContext({
        headless,
        profileName,
        debugMode: true
    });

    // Create a new page
    const page = await browserService.createPage();

    // Add additional event listeners
    if (page) {
        page.on('dialog', dialog => {
            logger.info(`Dialog appeared: ${dialog.type()} - ${dialog.message()}`);
            dialog.accept();
        });
    }

    return {
        config: amazonConfig,
        page,
        isLoggedIn: false
    };
}

export async function checkIfLoggedIn(page: Page): Promise<boolean> {
    try {
        const loggedInElement = await page.$(selectors.loggedInIndicator);
        const isLoggedIn = !!loggedInElement;

        if (isLoggedIn) {
            const accountText = await loggedInElement.textContent();
            logger.info(`Already logged in to Amazon as: ${accountText}`);
        }

        return isLoggedIn;
    } catch (error) {
        logger.error('Error checking Amazon login status', { error });
        return false;
    }
}

export async function performLogin(
    page: Page,
    credentials: Credential
): Promise<boolean> {
    try {
        // Enter username
        await page.waitForSelector(selectors.username);
        await page.fill(selectors.username, credentials.username);
        await page.click(selectors.continueButton);

        // Check for CAPTCHA
        const hasCaptcha = await page.$(selectors.captchaContainer) !== null;
        if (hasCaptcha) {
            logger.warn('CAPTCHA detected on Amazon login');

            // Switch to visible mode for user to solve CAPTCHA
            if (page.context().browser()) {
                // Take screenshot for debugging
                await browserService.takeScreenshot(
                    page,
                    `amazon-captcha-${Date.now()}.png`
                );

                // Wait for user to solve CAPTCHA
                // TODO: Implement notification system to alert user

                logger.info('Waiting for user to solve CAPTCHA (timeout in 5 minutes)');
                // Wait up to 5 minutes for user to solve
                await page.waitForNavigation({ timeout: 300000 });
            }
        }

        // Enter password (may or may not be visible depending on CAPTCHA flow)
        try {
            await page.waitForSelector(selectors.password, { timeout: 3000 });
            await page.fill(selectors.password, credentials.password);
            await page.click(selectors.signInButton);
        } catch (e) {
            // Password field might not be visible if CAPTCHA was bypassed
            logger.info('Password field not found, might be already logged in');
        }

        // Check if login succeeded
        await page.waitForNavigation();
        return await checkIfLoggedIn(page);
    } catch (error) {
        logger.error('Error during Amazon login process', { error });
        return false;
    }
}

export async function login(
    state: VendorState,
    credentials: Credential
): Promise<VendorState> {
    if (!state.page) {
        throw new Error('Browser not initialized');
    }

    logger.info(`Logging in to ${state.config.name}`);

    try {
        // Go to login page
        await state.page.goto(state.config.loginUrl, { waitUntil: 'networkidle' });

        // Check if already logged in
        const loggedIn = await checkIfLoggedIn(state.page);
        if (loggedIn) {
            logger.info(`Already logged in to ${state.config.name}`);
            return { ...state, isLoggedIn: true };
        }

        // Perform login
        const loginSuccess = await performLogin(state.page, credentials);

        if (loginSuccess) {
            logger.info(`Successfully logged in to ${state.config.name}`);
            return { ...state, isLoggedIn: true };
        } else {
            logger.error(`Failed to log in to ${state.config.name}`);
            return state;
        }
    } catch (error) {
        logger.error(`Login error for ${state.config.name}`, { error });

        // Take screenshot of the error
        if (state.page) {
            const screenshotPath = `logs/screenshots/${state.config.id}-login-error.png`;
            await browserService.takeScreenshot(state.page, screenshotPath);
        }

        return state;
    }
}

export async function navigateToInvoices(state: VendorState): Promise<boolean> {
    if (!state.page) {
        throw new Error('Browser not initialized');
    }

    try {
        logger.info(`Navigating to invoices page for ${state.config.name}`);
        await state.page.goto(state.config.invoiceListUrl, { waitUntil: 'networkidle' });
        return true;
    } catch (error) {
        logger.error(`Failed to navigate to invoices page for ${state.config.name}`, { error });
        return false;
    }
}

// Helper functions to extract invoice data
async function extractInvoiceNumber(page: Page): Promise<string> {
    try {
        // This is a simplified example, real implementation would use specific selectors
        const invoiceElement = await page.$('text=Invoice #');
        if (invoiceElement) {
            const text = await invoiceElement.textContent() || '';
            return text.replace('Invoice #', '').trim();
        }
        return `amazon-${Date.now()}`;
    } catch (error) {
        logger.error('Error extracting invoice number', { error });
        return `amazon-${Date.now()}`;
    }
}

async function extractIssueDate(page: Page): Promise<string> {
    try {
        // This is a simplified example, real implementation would use specific selectors
        const dateElement = await page.$('text=Invoice Date:');
        if (dateElement) {
            const text = await dateElement.evaluate(node => {
                const parent = node.parentElement;
                return parent ? parent.textContent || '' : '';
            });
            return text.replace('Invoice Date:', '').trim();
        }
        return new Date().toISOString().split('T')[0];
    } catch (error) {
        logger.error('Error extracting issue date', { error });
        return new Date().toISOString().split('T')[0];
    }
}

async function extractAmount(page: Page): Promise<number> {
    try {
        // This is a simplified example, real implementation would use specific selectors
        const totalElement = await page.$('text=Grand Total:');
        if (totalElement) {
            const text = await totalElement.evaluate(node => {
                const parent = node.parentElement;
                return parent ? parent.textContent || '' : '';
            });
            const amountStr = text.replace('Grand Total:', '').trim();
            const amount = parseFloat(amountStr.replace(/[^0-9.,]/g, '').replace(',', '.'));
            return isNaN(amount) ? 0 : amount;
        }
        return 0;
    } catch (error) {
        logger.error('Error extracting amount', { error });
        return 0;
    }
}

async function extractOrderNumber(page: Page): Promise<string> {
    try {
        // This is a simplified example, real implementation would use specific selectors
        const orderElement = await page.$('text=Order #');
        if (orderElement) {
            const text = await orderElement.textContent() || '';
            return text.replace('Order #', '').trim();
        }
        return '';
    } catch (error) {
        logger.error('Error extracting order number', { error });
        return '';
    }
}

export async function getInvoiceList(
    state: VendorState,
    limit: number = 10,
    fromDate?: Date
): Promise<InvoiceData[]> {
    if (!state.page) {
        throw new Error('Browser not initialized');
    }

    const invoices: InvoiceData[] = [];

    try {
        // Get all order rows
        const orderRows = await state.page.$$(selectors.orderRows);
        logger.info(`Found ${orderRows.length} orders on page`);

        // Process each order up to the limit
        for (let i = 0; i < Math.min(orderRows.length, limit); i++) {
            const orderRow = orderRows[i];

            // Find invoice link
            const invoiceLink = await orderRow.$(selectors.invoiceLink);
            if (!invoiceLink) {
                continue;
            }

            // Open invoice in new tab
            const [invoicePage] = await Promise.all([
                state.page.context().waitForEvent('page'),
                invoiceLink.click()
            ]);

            try {
                await invoicePage.waitForLoadState('networkidle');

                // Extract invoice data
                const invoiceNumber = await extractInvoiceNumber(invoicePage);
                const issueDate = await extractIssueDate(invoicePage);
                const amount = await extractAmount(invoicePage);

                // Click download button to get PDF
                await invoicePage.waitForSelector(selectors.downloadButton);

                // Set up download listener
                const downloadPromise = invoicePage.waitForEvent('download');
                await invoicePage.click(selectors.downloadButton);

                const download = await downloadPromise;
                const path = await download.path();

                // Read the file into a buffer
                const fileBuffer = fs.readFileSync(path!);

                // Add to invoice list
                invoices.push({
                    invoiceNumber,
                    issueDate,
                    amount,
                    currency: 'EUR', // Default, should be extracted from page
                    fileBuffer,
                    additionalData: {
                        orderNumber: await extractOrderNumber(invoicePage),
                        downloadedAt: new Date().toISOString()
                    }
                });

                // Close the tab
                await invoicePage.close();
            } catch (error) {
                logger.error(`Error processing invoice for order`, { error });
                await invoicePage.close();
            }
        }

        return invoices;
    } catch (error) {
        logger.error('Error getting Amazon invoices', { error });
        return [];
    }
}

export async function downloadInvoices(
    state: VendorState,
    limit?: number,
    fromDate?: Date
): Promise<number> {
    if (!state.page) {
        throw new Error('Browser not initialized');
    }

    // Navigate to invoices page
    const success = await navigateToInvoices(state);
    if (!success) {
        return 0;
    }

    try {
        // Get list of invoices
        const invoiceList = await getInvoiceList(state, limit, fromDate);
        logger.info(`Found ${invoiceList.length} invoices for ${state.config.name}`);

        let downloadCount = 0;

        // Download each invoice
        for (const invoice of invoiceList) {
            try {
                // Check if invoice already exists
                const exists = await storageService.invoiceExists(
                    state.config.id,
                    invoice.invoiceNumber
                );

                if (exists) {
                    logger.info(`Invoice ${invoice.invoiceNumber} already exists, skipping`);
                    continue;
                }

                // Store the invoice
                const filename = `${state.config.id}_${invoice.invoiceNumber}_${invoice.issueDate.replace(/\//g, '-')}.pdf`;

                const metadata: InvoiceMetadata = {
                    vendorId: state.config.id,
                    invoiceNumber: invoice.invoiceNumber,
                    issueDate: invoice.issueDate,
                    amount: invoice.amount,
                    currency: invoice.currency,
                    downloadDate: new Date(),
                    filename,
                    additionalData: invoice.additionalData
                };

                await storageService.storeInvoice(invoice.fileBuffer, metadata);
                downloadCount++;

                logger.info(`Downloaded invoice ${invoice.invoiceNumber} from ${state.config.name}`);
            } catch (error) {
                logger.error(`Failed to download invoice ${invoice.invoiceNumber}`, { error });
            }
        }

        return downloadCount;
    } catch (error) {
        logger.error(`Failed to download invoices from ${state.config.name}`, { error });
        return 0;
    }
}

export async function close(state: VendorState): Promise<void> {
    if (state.page) {
        await state.page.close();
    }
    logger.info(`Closed session for ${state.config.name}`);
}