/**
 * Invoice Automation UI
 * Using functional programming principles
 */

// Application state - immutable updates via functions
let appState = {
    vendors: [],
    invoices: [],
    jobs: {},
    logs: []
};

// Pure function to update state
const updateState = (updates) => {
    appState = { ...appState, ...updates };
    renderApp();
};

// Add a log entry
const addLog = (message, level = 'info') => {
    const timestamp = new Date().toISOString();
    const newLogs = [...appState.logs, { timestamp, message, level }];

    // Keep only the last 100 logs
    updateState({ logs: newLogs.slice(-100) });
};

// DOM element selectors - pure function
const getElement = (id) => document.getElementById(id);
const getElements = (selector) => Array.from(document.querySelectorAll(selector));

// Format date
const formatDate = (dateString) => {
    try {
        const date = new Date(dateString);
        return date.toLocaleString();
    } catch (error) {
        return dateString || 'Unknown';
    }
};

// Format currency
const formatCurrency = (amount, currency = 'EUR') => {
    try {
        return new Intl.NumberFormat('de-DE', {
            style: 'currency',
            currency
        }).format(amount);
    } catch (error) {
        return `${amount} ${currency}`;
    }
};

// Load data from API
const loadVendors = async () => {
    try {
        const vendors = await api.getVendors();
        updateState({ vendors });
    } catch (error) {
        addLog(`Failed to load vendors: ${error.message}`, 'error');
    }
};

const loadInvoices = async () => {
    try {
        const invoices = await api.getAllInvoices();
        updateState({ invoices });
    } catch (error) {
        addLog(`Failed to load invoices: ${error.message}`, 'error');
    }
};

const loadJobStatuses = async () => {
    try {
        const jobs = await api.getAllJobStatuses();
        updateState({ jobs });
    } catch (error) {
        addLog(`Failed to load job statuses: ${error.message}`, 'error');
    }
};

// Load all initial data
const loadAllData = async () => {
    addLog('Loading application data...');
    await Promise.all([
        loadVendors(),
        loadInvoices(),
        loadJobStatuses()
    ]);
    addLog('Application data loaded successfully');
};

// Render functions - pure functions to create HTML
const renderVendorsList = () => {
    const vendorsListElement = getElement('vendors-list');
    if (!vendorsListElement) return;

    const vendorsHtml = appState.vendors.map(vendor => {
        const job = appState.jobs[vendor.id];
        const jobStatus = job ? job.status : 'not_started';
        const statusClass = jobStatus === 'running' ? 'bg-warning' :
            jobStatus === 'completed' ? 'bg-success' :
                jobStatus === 'failed' ? 'bg-danger' : 'bg-secondary';

        return `
      <div class="list-group-item d-flex justify-content-between align-items-center">
        <div>
          <strong>${vendor.name}</strong>
          <small class="d-block text-muted">Click Fetch to download invoices</small>
        </div>
        <div>
          <span class="badge ${statusClass}">${jobStatus.replaceAll('_', ' ')}</span>
          <button class="btn btn-sm btn-outline-primary ms-2 btn-fetch-vendor" data-vendor-id="${vendor.id}">
            Fetch
          </button>
        </div>
      </div>
    `;
    }).join('');

    vendorsListElement.innerHTML = vendorsHtml;

    // Attach event listeners
    getElements('.btn-fetch-vendor').forEach(button => {
        button.addEventListener('click', (e) => {
            const vendorId = e.target.dataset.vendorId;
            startVendorJob(vendorId);
        });
    });
};

const renderInvoicesTable = () => {
    const invoicesTable = getElement('invoices-table');
    if (!invoicesTable) return;

    // Sort invoices by date, newest first
    const sortedInvoices = [...appState.invoices].sort((a, b) =>
        new Date(b.downloadDate).getTime() - new Date(a.downloadDate).getTime()
    );

    // Take only the latest 10
    const recentInvoices = sortedInvoices.slice(0, 10);

    const invoicesHtml = recentInvoices.map(invoice => {
        const vendor = appState.vendors.find(v => v.id === invoice.vendorId) || { name: invoice.vendorId };
        return `
      <tr>
        <td>${vendor.name}</td>
        <td>${invoice.invoiceNumber}</td>
        <td>${invoice.issueDate}</td>
        <td>${formatCurrency(invoice.amount, invoice.currency)}</td>
        <td>
          ${invoice.filePath ? `
            <a href="/api/file?path=${encodeURIComponent(invoice.filePath)}" 
               class="btn btn-sm btn-outline-primary" target="_blank">
              View
            </a>
          ` : ''}
        </td>
      </tr>
    `;
    }).join('');

    invoicesTable.innerHTML = invoicesHtml.length ? invoicesHtml :
        '<tr><td colspan="5" class="text-center">No invoices downloaded yet</td></tr>';
};

const renderLogs = () => {
    const logsContainer = getElement('logs-container');
    if (!logsContainer) return;

    const logsHtml = appState.logs.map(log => {
        const logClass = log.level === 'error' ? 'text-danger' :
            log.level === 'warn' ? 'text-warning' : 'text-info';
        return `<div class="${logClass}">[${log.timestamp}] ${log.message}</div>`;
    }).join('');

    logsContainer.innerHTML = logsHtml;

    // Auto-scroll to bottom
    logsContainer.scrollTop = logsContainer.scrollHeight;
};

// Function to render the entire app
const renderApp = () => {
    renderVendorsList();
    renderInvoicesTable();
    renderLogs();

    // Update status badge
    const statusBadge = getElement('status-badge');
    if (statusBadge) {
        const anyRunningJobs = Object.values(appState.jobs).some(job => job.status === 'running');
        statusBadge.textContent = anyRunningJobs ? 'Jobs Running' : 'Ready';
        statusBadge.className = `ms-auto badge ${anyRunningJobs ? 'bg-warning' : 'bg-success'}`;
    }
};

// Handle job status polling
let statusPollingInterval = null;

const startStatusPolling = () => {
    // Clear any existing interval
    if (statusPollingInterval) {
        clearInterval(statusPollingInterval);
    }

    // Create new interval
    statusPollingInterval = setInterval(async () => {
        await loadJobStatuses();
        await loadInvoices();

        // Check if we need to stop polling (all jobs completed)
        const anyRunningJobs = Object.values(appState.jobs).some(job => job.status === 'running');
        if (!anyRunningJobs && statusPollingInterval) {
            clearInterval(statusPollingInterval);
            statusPollingInterval = null;
            addLog('All jobs completed');
        }
    }, 3000);
};

// API interaction functions
const startVendorJob = async (vendorId) => {
    try {
        addLog(`Starting invoice fetch job for ${vendorId}...`);
        await api.startVendorJob(vendorId);
        await loadJobStatuses();
        startStatusPolling();
    } catch (error) {
        addLog(`Failed to start job: ${error.message}`, 'error');
    }
};

const startAllJobs = async () => {
    try {
        addLog('Starting invoice fetch for all configured vendors...');
        await api.startAllJobs();
        await loadJobStatuses();
        startStatusPolling();
    } catch (error) {
        addLog(`Failed to start jobs: ${error.message}`, 'error');
    }
};

// Initialize app
const initializeApp = async () => {
    addLog('Initializing application...');

    // Load all data
    await loadAllData();

    // Set up event listeners
    const btnFetchAll = getElement('btn-fetch-all');
    if (btnFetchAll) {
        btnFetchAll.addEventListener('click', startAllJobs);
    }

    const btnClearLogs = getElement('btn-clear-logs');
    if (btnClearLogs) {
        btnClearLogs.addEventListener('click', () => {
            updateState({ logs: [] });
        });
    }

    // Check for any running jobs and start polling if needed
    const anyRunningJobs = Object.values(appState.jobs).some(job => job.status === 'running');
    if (anyRunningJobs) {
        startStatusPolling();
    }

    addLog('Application initialized');
    addLog('Ready to download invoices from your browser. Make sure you are logged into your accounts first.');
};

// Start the application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});