import fs from 'fs/promises';
import path from 'path';
import { config } from '../config/config';
import { logger } from '../utils/logger';

// Type definitions
export type InvoiceMetadata = {
    vendorId: string;
    invoiceNumber: string;
    issueDate: string;
    amount: number;
    currency: string;
    downloadDate: Date;
    filename: string;
    filePath?: string;
    additionalData?: Record<string, any>;
};

// Constants
const STORAGE_PATH = config.storage.invoicePath;
const METADATA_FILE = path.join(STORAGE_PATH, 'metadata.json');

// Core functions
export async function initializeStorage(): Promise<void> {
    try {
        // Create storage directory if it doesn't exist
        await fs.mkdir(STORAGE_PATH, { recursive: true });

        // Create metadata file if it doesn't exist
        try {
            await fs.access(METADATA_FILE);
        } catch {
            await fs.writeFile(METADATA_FILE, JSON.stringify([]));
        }

        logger.info('Storage service initialized');
    } catch (error) {
        logger.error('Failed to initialize storage service', { error });
        throw error;
    }
}

export async function storeInvoice(
    fileBuffer: Buffer,
    metadata: InvoiceMetadata
): Promise<string> {
    try {
        // Create vendor-specific directory
        const vendorDir = path.join(STORAGE_PATH, metadata.vendorId);
        await fs.mkdir(vendorDir, { recursive: true });

        // Generate a filename if not provided
        if (!metadata.filename) {
            const dateStr = new Date().toISOString().slice(0, 10);
            metadata.filename = `${metadata.vendorId}_${metadata.invoiceNumber}_${dateStr}.pdf`;
        }

        // Save the file
        const filePath = path.join(vendorDir, metadata.filename);
        await fs.writeFile(filePath, fileBuffer);

        // Update metadata
        const fullMetadata = {
            ...metadata,
            downloadDate: new Date(),
            filePath: filePath
        };

        await addMetadata(fullMetadata);

        logger.info(`Invoice stored: ${filePath}`);
        return filePath;
    } catch (error) {
        logger.error('Failed to store invoice', { error, metadata });
        throw error;
    }
}

async function addMetadata(metadata: InvoiceMetadata): Promise<void> {
    try {
        // Read existing metadata
        const allMetadata = await getAllMetadata();

        // Add new metadata (immutable way)
        const updatedMetadata = [...allMetadata, metadata];

        // Write updated metadata
        await fs.writeFile(METADATA_FILE, JSON.stringify(updatedMetadata, null, 2));
    } catch (error) {
        logger.error('Failed to update metadata', { error });
        throw error;
    }
}

export async function getAllMetadata(): Promise<InvoiceMetadata[]> {
    try {
        const data = await fs.readFile(METADATA_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        logger.error('Failed to read metadata', { error });
        return [];
    }
}

export async function getMetadataByVendor(vendorId: string): Promise<InvoiceMetadata[]> {
    const allMetadata = await getAllMetadata();
    return allMetadata.filter(item => item.vendorId === vendorId);
}

export async function invoiceExists(vendorId: string, invoiceNumber: string): Promise<boolean> {
    const vendorMetadata = await getMetadataByVendor(vendorId);
    return vendorMetadata.some(item => item.invoiceNumber === invoiceNumber);
}

export async function getInvoiceFile(filePath: string): Promise<Buffer> {
    try {
        return await fs.readFile(filePath);
    } catch (error) {
        logger.error('Failed to read invoice file', { error, filePath });
        throw error;
    }
}