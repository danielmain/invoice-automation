# Invoice Automation

A functional Node.js application to automate the downloading of invoices from various online services.

## Core Features

- **Secure Credential Management**: Credentials are stored locally and encrypted
- **Browser Automation**: Uses Playwright to automate invoice downloads
- **Vendor Modularity**: Each vendor implementation is separate and independent
- **Web UI**: Simple web interface to manage credentials and download jobs

## Getting Started

### Prerequisites

- Node.js 16+
- npm or yarn

### Installation

1. Clone the repository
   ```sh
   git clone https://github.com/yourusername/invoice-automation.git
   cd invoice-automation
   ```

2. Install dependencies
   ```sh
   npm install
   ```

3. Create a `.env` file with your configuration (see `.env.example`)
   ```sh
   cp .env.example .env
   # Edit .env with your preferred settings
   ```

4. Build the application
   ```sh
   npm run build
   ```

### Running the Application

For development:
```sh
npm run dev
```

With auto-reload:
```sh
npm run dev:watch
```

For production:
```sh
npm start
```

## Usage

1. Open the web UI at `http://localhost:3000` (or your configured port)
2. Add vendor credentials
3. Click "Fetch" to download invoices for a specific vendor, or "Fetch All" for all vendors
4. View downloaded invoices in the UI

## Project Structure

```
invoice-automation/
├── src/                    # Source code
│   ├── config/             # Configuration
│   ├── services/           # Core services (browser, storage, etc.)
│   ├── utils/              # Utility functions
│   ├── vendors/            # Vendor-specific implementations
│   ├── ui/                 # Web interface
│   └── index.ts            # Main entry point
├── invoices/               # Downloaded invoices storage
├── logs/                   # Application logs
└── profiles/               # Browser profiles
```

## Adding New Vendors

The application is designed to make it easy to add new vendor implementations:

1. Create a new file in `src/vendors/` (use amazon.ts as a template)
2. Implement the required functions for the vendor
3. Add the vendor to the `SUPPORTED_VENDORS` list in `src/index.ts`

## Functional Programming Approach

This project uses a functional programming approach with:

- Pure functions where possible
- Explicit state management
- Immutable data patterns
- Minimal side effects

## Security

- Credentials are encrypted with AES using your provided encryption key
- No credentials are sent to external servers
- Browser automation runs locally