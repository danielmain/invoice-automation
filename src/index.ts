import express from 'express';
import path from 'path';
import cors from 'cors';
import bodyParser from 'body-parser';
import { config } from './config/config';
import { logger } from './utils/logger';

// Import services
import * as browserService from './services/browser';
import * as storageService from './services/storage';
import { runBrowserDiagnostics } from './services/browser-diagnostic';

// Import vendors
import * as amazonVendor from './vendors/amazon';

// Define supported vendors
const SUPPORTED_VENDORS = [
    { id: 'amazon', name: 'Amazon' },
    { id: 'google', name: 'Google Workspace' },
    { id: 'vodafone', name: 'Vodafone' }
];

// Global state - minimized and kept in one place
const appState = {
    running: false,
    currentJobs: new Map()
};

/**
 * Initialize all services
 */
async function initializeServices() {
    logger.info('Initializing services...');

    try {
        // Run browser diagnostics first to identify any issues
        logger.info('Running browser environment diagnostics');
        await runBrowserDiagnostics();

        // Initialize services in sequence
        await browserService.initializeBrowser();
        logger.info('Browser service initialized');

        await storageService.initializeStorage();
        logger.info('Storage service initialized');

        logger.info('All services initialized successfully');
    } catch (error) {
        logger.error('Failed to initialize services', {
            error,
            errorType: error instanceof Error ? error.constructor.name : typeof error,
            errorMessage: error instanceof Error ? error.message : String(error)
        });
        throw error;
    }
}

/**
 * Run a vendor download job
 */
async function runVendorJob(vendorId: string, options: { limit?: number, fromDate?: Date } = {}) {
    logger.info(`Starting download job for vendor: ${vendorId}`);

    // Mark job as running
    appState.currentJobs.set(vendorId, { status: 'running', startedAt: new Date() });

    try {
        // Initialize vendor-specific handler
        let vendorState;
        let downloadCount = 0;

        switch (vendorId) {
            case 'amazon':
                // Initialize Amazon vendor - use system browser
                vendorState = await amazonVendor.initialize(false, 'amazon-profile');

                // Download invoices - we skip login since we're using the user's browser
                downloadCount = await amazonVendor.downloadInvoices(
                    vendorState,
                    options.limit,
                    options.fromDate
                );

                // Close session
                await amazonVendor.close(vendorState);
                break;

            // Add other vendors here
            default:
                logger.error(`Unsupported vendor: ${vendorId}`);
                appState.currentJobs.set(vendorId, {
                    status: 'failed',
                    error: 'Unsupported vendor',
                    finishedAt: new Date()
                });
                return;
        }

        // Update job status
        appState.currentJobs.set(vendorId, {
            status: 'completed',
            downloadCount,
            finishedAt: new Date()
        });

        logger.info(`Download job completed for ${vendorId}. Downloaded ${downloadCount} invoices.`);
    } catch (error) {
        logger.error(`Error in vendor job: ${vendorId}`, { error });

        // Update job status
        appState.currentJobs.set(vendorId, {
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
            finishedAt: new Date()
        });
    }
}

/**
 * Run all vendor jobs
 */
async function runAllVendorJobs(options: { limit?: number, fromDate?: Date } = {}) {
    logger.info('Starting download jobs for all vendors');

    // Run for all supported vendors
    for (const vendor of SUPPORTED_VENDORS) {
        await runVendorJob(vendor.id, options);
    }

    logger.info('All vendor jobs completed');
}

/**
 * Setup Express server
 */
function setupExpressServer() {
    const app = express();
    const port = config.server.port;

    // Configure middleware
    app.use(cors());
    app.use(bodyParser.json());
    app.use(express.static(path.join(__dirname, 'ui/public')));

    // Logging middleware
    app.use((req, res, next) => {
        logger.info(`${req.method} ${req.url}`);
        next();
    });

    // API routes
    const apiRouter = express.Router();

    // Vendors
    apiRouter.get('/vendors', (req, res) => {
        res.json(SUPPORTED_VENDORS);
    });

    // Invoices
    apiRouter.get('/invoices', async (req, res) => {
        try {
            const allMetadata = await storageService.getAllMetadata();
            res.json(allMetadata);
        } catch (error) {
            logger.error('Error getting invoices', { error });
            res.status(500).json({ error: 'Failed to get invoices' });
        }
    });

    apiRouter.get('/invoices/:vendorId', async (req, res) => {
        try {
            const { vendorId } = req.params;
            const metadata = await storageService.getMetadataByVendor(vendorId);
            res.json(metadata);
        } catch (error) {
            logger.error('Error getting vendor invoices', { error });
            res.status(500).json({ error: 'Failed to get invoices' });
        }
    });

    // File download
    apiRouter.get('/file', async (req, res) => {
        try {
            const filePath = req.query.path as string;
            if (!filePath) {
                return res.status(400).json({ error: 'Path parameter is required' });
            }

            // Prevent directory traversal
            const normalizedPath = path.normalize(filePath);
            if (normalizedPath.includes('..')) {
                return res.status(403).json({ error: 'Invalid path' });
            }

            const buffer = await storageService.getInvoiceFile(filePath);

            // Set content type based on file extension
            const ext = path.extname(filePath).toLowerCase();
            if (ext === '.pdf') {
                res.contentType('application/pdf');
            } else if (ext === '.html') {
                res.contentType('text/html');
            } else {
                res.contentType('application/octet-stream');
            }

            res.send(buffer);
        } catch (error) {
            logger.error('Error serving file', { error });
            res.status(404).json({ error: 'File not found' });
        }
    });

    // Jobs
    apiRouter.post('/jobs/:vendorId', async (req, res) => {
        try {
            const { vendorId } = req.params;
            const { limit, fromDate } = req.body;

            // Check if job is already running
            const existingJob = appState.currentJobs.get(vendorId);
            if (existingJob && existingJob.status === 'running') {
                res.status(409).json({ error: 'Job already running for this vendor' });
                return;
            }

            // Run job in background
            runVendorJob(vendorId, {
                limit: limit ? parseInt(limit) : undefined,
                fromDate: fromDate ? new Date(fromDate) : undefined
            });

            res.json({ status: 'started', vendorId });
        } catch (error) {
            logger.error('Error starting vendor job', { error });
            res.status(500).json({ error: 'Failed to start job' });
        }
    });

    apiRouter.post('/jobs', async (req, res) => {
        try {
            const { limit, fromDate } = req.body;

            // Run all jobs in background
            runAllVendorJobs({
                limit: limit ? parseInt(limit) : undefined,
                fromDate: fromDate ? new Date(fromDate) : undefined
            });

            res.json({ status: 'started' });
        } catch (error) {
            logger.error('Error starting all vendor jobs', { error });
            res.status(500).json({ error: 'Failed to start jobs' });
        }
    });

    apiRouter.get('/jobs', (req, res) => {
        // Return all job statuses
        const jobStatuses = Object.fromEntries(appState.currentJobs);
        res.json(jobStatuses);
    });

    apiRouter.get('/jobs/:vendorId', (req, res) => {
        const { vendorId } = req.params;
        const jobStatus = appState.currentJobs.get(vendorId) || { status: 'not_started' };
        res.json(jobStatus);
    });

    // Mount API routes
    app.use('/api', apiRouter);

    // Serve index.html for all other routes (SPA support)
    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, 'ui/public', 'index.html'));
    });

    // Start server
    app.listen(port, () => {
        logger.info(`Server listening on port ${port}`);
    });
}

/**
 * Main application function
 */
async function startApplication() {
    try {
        logger.info('Starting invoice automation application');

        // Set running flag
        appState.running = true;

        // Initialize all services
        await initializeServices();

        // Set up Express server
        setupExpressServer();

        logger.info('Application started successfully');
    } catch (error) {
        logger.error('Failed to start application', { error });
        process.exit(1);
    }
}

// Handle process termination
process.on('SIGINT', async () => {
    logger.info('Shutting down...');
    appState.running = false;

    // Close browser if open
    await browserService.closeBrowser();

    logger.info('Shutdown complete');
    process.exit(0);
});

// Start the application
startApplication();