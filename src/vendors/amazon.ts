import fs from 'fs';
import { Page } from 'playwright';
import { InvoiceMetadata } from '../services/storage';
import { logger } from '../utils/logger';
import * as browserService from '../services/browser';
import * as storageService from '../services/storage';

// Type definitions
export type VendorConfig = {
    id: string;
    name: string;
    invoiceListUrl: string;
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
};

// Amazon-specific configuration and selectors
export const amazonConfig: VendorConfig = {
    id: 'amazon',
    name: 'Amazon',
    invoiceListUrl: 'https://www.amazon.de/gp/css/order-history?ref_=abn_yadd_ad_your_orders',
};

const selectors = {
    orderHistoryLink: '#nav-orders',
    orderFilter: '#time-filter',
    orderRows: '.order-card',
    invoiceLink: 'a[href*="invoice"]',
    downloadButton: 'input[name="Download"]',
    // Add more specific selectors as needed
};

// Core functions
export async function initialize(
    headless = false,  // Default to visible browser for system browser integration
    profileName = 'amazon-profile'
): Promise<VendorState> {
    logger.info(`Initializing Amazon vendor with headless=${headless}, profileName=${profileName}`);

    try {
        // Create browser context with system browser preference
        logger.info('Creating browser context with system browser preference');
        const context = await browserService.createBrowserContext({
            headless,
            profileName,
            debugMode: true,
            useSystemBrowser: true  // Prefer system browser
        });

        // Create a new page
        logger.info('Creating new page in browser context');
        const page = await browserService.createPage().catch(err => {
            logger.error(`Error creating page: ${err instanceof Error ? err.message : String(err)}`);
            throw err;
        });

        logger.info('Browser page created successfully');

        // Add additional event listeners
        if (page) {
            logger.info('Adding dialog handler to page');
            page.on('dialog', dialog => {
                logger.info(`Dialog appeared: ${dialog.type()} - ${dialog.message()}`);
                dialog.accept();
            });
        }

        logger.info('Amazon vendor initialization completed successfully');

        return {
            config: amazonConfig,
            page,
        };
    } catch (error) {
        logger.error('Failed to initialize Amazon vendor', {
            error,
            errorType: error instanceof Error ? error.constructor.name : typeof error,
            errorMessage: error instanceof Error ? error.message : String(error),
            headless,
            profileName
        });
        throw error;
    }
}

export async function navigateToInvoices(state: VendorState): Promise<boolean> {
    if (!state.page) {
        throw new Error('Browser not initialized');
    }

    try {
        logger.info(`Navigating to invoices page for ${state.config.name}`);

        // Target URL is the order history/invoices page
        const targetUrl = state.config.invoiceListUrl;

        // Wait for user to login and reach the target URL
        const isLoggedIn = await browserService.waitForUserLogin(
            state.page,
            targetUrl
        );

        if (!isLoggedIn) {
            logger.error('Failed to login to Amazon');
            return false;
        }

        // At this point we are on the order history page
        logger.info('Successfully navigated to Amazon order history page');
        return true;
    } catch (error) {
        logger.error(`Failed to navigate to invoices page for ${state.config.name}`, {
            error: error instanceof Error ? error.message : String(error)
        });
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
        // Select appropriate time filter if fromDate is provided
        if (fromDate) {
            await state.page.waitForSelector(selectors.orderFilter);
            // Select appropriate filter based on date
            // This is a simplified example, real implementation would be more complex
            await state.page.selectOption(selectors.orderFilter, { value: 'year-2024' });
        }

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