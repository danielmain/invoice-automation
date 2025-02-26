/**
 * API client for Invoice Automation
 * Uses functional programming approach with pure functions
 */

// Base API URL
const API_BASE_URL = '/api';

// Pure function to create API URLs
const createUrl = (endpoint) => `${API_BASE_URL}${endpoint}`;

// Generic fetch wrapper with error handling
const fetchApi = async (url, options = {}) => {
    try {
        const response = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers,
            },
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `API error: ${response.status}`);
        }

        return response.json();
    } catch (error) {
        console.error(`API request failed: ${url}`, error);
        throw error;
    }
};

// API functions - all pure and returning promises
const api = {
    // Vendors
    getVendors: () => fetchApi(createUrl('/vendors')),

    // Credentials
    getCredentials: () => fetchApi(createUrl('/credentials')),

    saveCredential: (vendorId, credentials) => fetchApi(
        createUrl(`/credentials/${vendorId}`),
        {
            method: 'POST',
            body: JSON.stringify(credentials),
        }
    ),

    deleteCredential: (vendorId) => fetchApi(
        createUrl(`/credentials/${vendorId}`),
        { method: 'DELETE' }
    ),

    // Invoices
    getAllInvoices: () => fetchApi(createUrl('/invoices')),

    getVendorInvoices: (vendorId) => fetchApi(createUrl(`/invoices/${vendorId}`)),

    // Jobs
    startVendorJob: (vendorId, options = {}) => fetchApi(
        createUrl(`/jobs/${vendorId}`),
        {
            method: 'POST',
            body: JSON.stringify(options),
        }
    ),

    startAllJobs: (options = {}) => fetchApi(
        createUrl('/jobs'),
        {
            method: 'POST',
            body: JSON.stringify(options),
        }
    ),

    getJobStatus: (vendorId) => fetchApi(createUrl(`/jobs/${vendorId}`)),

    getAllJobStatuses: () => fetchApi(createUrl('/jobs')),
};