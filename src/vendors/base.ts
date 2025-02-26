// NOTE: This file is deprecated and should be deleted.
// We've moved to a functional programming approach instead of classes.
// This file only exists to make TypeScript compilation pass.

import { Page } from 'playwright';
import path from 'path';
import { logger } from '../utils/logger';

// Mock types to satisfy TypeScript
type BrowserService = any;
type CredentialService = any;
type StorageService = any;

export type Credential = {
    username: string;
    password: string;
    additionalFields?: Record<string, string>;
    lastUpdated: Date;
};

export type InvoiceMetadata = {
    vendorId: string;
    invoiceNumber: string;
    issueDate: string;
    amount: number;
    currency: string;
    downloadDate: Date;
    filename: string;
    additionalData?: Record<string, any>;
};

export interface VendorConfig {
    id: string;
    name: string;
    loginUrl: string;
    invoiceListUrl: string;
    requiresInteraction?: boolean;
    authTimeoutMs?: number;
    downloadTimeoutMs?: number;
}

export interface InvoiceData {
    invoiceNumber: string;
    issueDate: string;
    amount: number;
    currency: string;
    fileBuffer: Buffer;
    additionalData?: Record<string, any>;
}

// A skeleton base class that will be ignored in the functional implementation
export abstract class BaseVendor {
    protected config: VendorConfig;
    protected browserService: BrowserService;
    protected credentialService: CredentialService;
    protected storageService: StorageService;
    protected page: Page | null = null;
    protected isLoggedIn = false;

    constructor(
        config: VendorConfig,
        browserService: BrowserService,
        credentialService: CredentialService,
        storageService: StorageService
    ) {
        this.config = config;
        this.browserService = browserService;
        this.credentialService = credentialService;
        this.storageService = storageService;
    }

    // Stub methods to satisfy TypeScript
    async initialize(): Promise<void> {
        logger.info('Base vendor initialize called - should not be used');
        if (this.page) {
            this.page.on('dialog', dialog => {
                logger.info(`Dialog appeared: ${dialog.type()} - ${dialog.message()}`);
                dialog.accept();
            });
        }
    }

    // Abstract methods that would be implemented by specific vendors
    protected abstract checkIfLoggedIn(): Promise<boolean>;
    protected abstract performLogin(credentials: Credential): Promise<boolean>;
    protected abstract getInvoiceList(limit?: number, fromDate?: Date): Promise<InvoiceData[]>;
}