/**
 * Invoice Automation UI
 * Using functional programming principles
 */

// Application state - immutable updates via functions
let appState = {
    vendors: [],
    credentials: {},
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

const loadCredentials = async () => {
    try {
        const credentials = await api.getCredentials();
        updateState({ credentials });
    } catch (error) {
        addLog(`Failed to load credentials: ${error.message}`, 'error');
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
        loadCredentials(),
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
        const hasCredentials = !!appState.credentials[vendor.id];
        const job = appState.jobs[vendor.id];
        const jobStatus = job ? job.status : 'not_started';
        const statusClass = jobStatus === 'running' ? 'bg-warning' :
            jobStatus === 'completed' ? 'bg-success' :
                jobStatus === 'failed' ? 'bg-danger' : 'bg-secondary';

        return `
      <div class="list-group-item d-flex justify-content-between align-items-center">
        <div>
          <strong>${vendor.name}</strong>
          <small class="d-block text-muted">${hasCredentials ? 'Configured' : 'Not configured'}</small>
        </div>
        <div>
          <span class="badge ${statusClass}">${jobStatus.replaceAll('_', ' ')}</span>
          <button class="btn btn-sm btn-outline-primary ms-2 btn-fetch-vendor" data-vendor-id="${vendor.id}"
                  ${!hasCredentials ? 'disabled' : ''}>
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

const renderCredentialsTable = () => {
    const credentialsTable = getElement('credentials-table');
    if (!credentialsTable) return;

    const credentialsHtml = Object.entries(appState.credentials).map(([vendorId, cred]) => {
        const vendor = appState.vendors.find(v => v.id === vendorId) || { name: vendorId };
        const has2fa = cred.useTotp && cred.totpSecret;
        return `
      <tr>
        <td>${vendor.name}</td>
        <td>${cred.username}</td>
        <td>
          ${has2fa
            ? '<span class="badge bg-success">Enabled</span>'
            : '<span class="badge bg-secondary">Disabled</span>'
        }
        </td>
        <td>${formatDate(cred.lastUpdated)}</td>
        <td>
          <button class="btn btn-sm btn-outline-danger btn-delete-credential" data-vendor-id="${vendorId}">
            Delete
          </button>
        </td>
      </tr>
    `;
    }).join('');

    credentialsTable.innerHTML = credentialsHtml.length ? credentialsHtml :
        '<tr><td colspan="5" class="text-center">No credentials configured</td></tr>';

    // Attach event listeners
    getElements('.btn-delete-credential').forEach(button => {
        button.addEventListener('click', (e) => {
            const vendorId = e.target.dataset.vendorId;
            deleteCredential(vendorId);
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

const renderVendorSelect = () => {
    const vendorSelect = getElement('vendor-select');
    if (!vendorSelect) return;

    // Clear existing options (keep the first one)
    while (vendorSelect.options.length > 1) {
        vendorSelect.remove(1);
    }

    // Add vendor options
    appState.vendors.forEach(vendor => {
        const option = document.createElement('option');
        option.value = vendor.id;
        option.textContent = vendor.name;
        vendorSelect.appendChild(option);
    });
};

// Function to render the entire app
const renderApp = () => {
    renderVendorsList();
    renderCredentialsTable();
    renderInvoicesTable();
    renderLogs();
    renderVendorSelect();

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
const saveCredential = async (vendorId, username, password, useTotp = false, totpSecret = null) => {
    try {
        addLog(`Saving credentials for ${vendorId}...`);
        await api.saveCredential(vendorId, {
            username,
            password,
            useTotp,
            totpSecret
        });
        addLog(`Credentials saved for ${vendorId}`);
        await loadCredentials();
    } catch (error) {
        addLog(`Failed to save credentials: ${error.message}`, 'error');
    }
};

const deleteCredential = async (vendorId) => {
    if (!confirm(`Are you sure you want to delete credentials for ${vendorId}?`)) {
        return;
    }

    try {
        addLog(`Deleting credentials for ${vendorId}...`);
        await api.deleteCredential(vendorId);
        addLog(`Credentials deleted for ${vendorId}`);
        await loadCredentials();
    } catch (error) {
        addLog(`Failed to delete credentials: ${error.message}`, 'error');
    }
};

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

    const btnSaveCredential = getElement('btn-save-credential');
    if (btnSaveCredential) {
        btnSaveCredential.addEventListener('click', () => {
            const vendorId = getElement('vendor-select').value;
            const username = getElement('username-input').value;
            const password = getElement('password-input').value;
            const useTotp = getElement('use-totp-check').checked;
            const totpSecret = getElement('totp-secret-input').value;

            console.log("Save credential button clicked");
            console.log("Vendor ID:", vendorId);
            console.log("Username:", username);
            console.log("Password:", password ? "***PROVIDED***" : "MISSING");
            console.log("Use TOTP:", useTotp);
            console.log("TOTP Secret:", totpSecret ? totpSecret : "EMPTY");

            if (!vendorId || !username || !password) {
                alert('All fields are required');
                return;
            }

            // Validate TOTP secret if using 2FA
            if (useTotp && totpSecret) {
                console.log("Validating TOTP secret...");
                const valid = isValidTOTPSecret(totpSecret);
                console.log("TOTP validation result:", valid);

                if (!valid) {
                    alert('Invalid TOTP secret. Please check and try again.\n\nThe secret should be a Base32 string (letters A-Z and numbers 2-7) and at least 16 characters long.\n\nExample: JBSWY3DPEHPK3PXP');
                    return;
                }
            } else if (useTotp) {
                alert('TOTP secret is required when 2FA is enabled');
                return;
            }

            saveCredential(vendorId, username, password, useTotp, totpSecret);

            // Clear form
            getElement('vendor-select').value = '';
            getElement('username-input').value = '';
            getElement('password-input').value = '';
            getElement('use-totp-check').checked = false;
            getElement('totp-config').classList.add('d-none');
            getElement('totp-secret-input').value = '';

            // Stop TOTP timer
            stopTOTPTimer();

            // Close modal
            const modal = bootstrap.Modal.getInstance(getElement('credential-modal'));
            if (modal) modal.hide();
        });
    }

    // Set up TOTP checkbox and test button
    const useTotpCheck = getElement('use-totp-check');
    const totpConfig = getElement('totp-config');

    if (useTotpCheck && totpConfig) {
        // Immediate check in case the checkbox is already checked
        if (useTotpCheck.checked) {
            totpConfig.classList.remove('d-none');
        }

        // Add event listener for change
        useTotpCheck.addEventListener('change', function() {
            if (this.checked) {
                totpConfig.classList.remove('d-none');
            } else {
                totpConfig.classList.add('d-none');
                stopTOTPTimer();
            }
        });
    }

    const testTotpBtn = getElement('test-totp-btn');
    if (testTotpBtn) {
        testTotpBtn.addEventListener('click', () => {
            const secret = getElement('totp-secret-input').value;

            if (!isValidTOTPSecret(secret)) {
                alert('Invalid TOTP secret. Please enter a valid Base32 secret key.');
                return;
            }

            startTOTPTimer(secret);
        });
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
};

// Start the application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});