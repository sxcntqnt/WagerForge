# Sportsbook Automation Engine

## Overview

This is a scalable, modular JavaScript engine designed for automating interactions with online sportsbooks. It leverages **Puppeteer** for browser automation to simulate user actions like logging in, searching events, selecting odds, placing bets, and managing accounts. The engine is built to handle **upwards of 60 sportsbooks** by parameterizing base URLs and sportsbook-specific identifiers, making it highly extensible.

Key features:
- **Modular Design**: Separate classes for core functionalities (e.g., `UserSession`, `EventSearch`, `OddsSelector`).
- **NATS Integration**: Acts as a consumer for bet placement requests via NATS messaging, allowing asynchronous, distributed processing. It can respond with results (e.g., payout info or errors).
- **Bet Flow Automation**: End-to-end bet placement, including search, selection, staking, confirmation, and notifications.
- **Live Betting & Monitoring**: Support for live games, line movement tracking, cash-outs, and promotions.
- **Scalability**: Each instance can target a specific sportsbook; run multiple instances for parallel processing across books.

The engine is intended for testing, arbitrage opportunities, or automated betting strategies. **Use responsibly and in compliance with terms of service and local laws.**

## Architecture

- **Core Classes** (in individual files):
  - `UserSession.js`: Handles login, logout, balance checks, and account updates.
  - `EventSearch.js`: Searches and filters events by query, sport, date, or league.
  - `OddsSelector.js`: Selects odds for moneyline, spreads, or totals.
  - `BetSlip.js`: Manages bet slip additions, removals, stakes, and payout calculations.
  - `LiveBetting.js`: Fetches live games, places in-play bets, and updates odds.
  - `LineMovementTracker.js`: Tracks odds history and detects movements.
  - `FilterOptions.js`: Applies filters for sports, markets, and time ranges.
  - `BetConfirmation.js`: Displays summaries, confirms bets, and handles errors.
  - `BetHistory.js`: Retrieves and filters past bets.
  - `PromotionsManager.js`: Manages promotions and boosted odds.
  - `CashOutManager.js`: Handles cash-outs and bet edits.
  - `NotificationCenter.js`: Manages notifications and alerts.

- **SportsbookApp.js**: Orchestrates all modules, exposing high-level methods like `placeBet()` and `launchApp()`.

- **executor.js**: The main entry point. Initializes Puppeteer, creates a `SportsbookApp` instance, and sets up a NATS consumer for processing bet requests.

## Prerequisites

- **Node.js**: v18+ (tested with v20).
- **NATS Server**: Running instance (e.g., via Docker: `docker run -p 4222:4222 nats:latest`).
- **Puppeteer Dependencies**: Chrome/Chromium browser (Puppeteer will download it on first run if using `puppeteer` instead of `puppeteer-core`).
- **Environment**: Unix-like OS recommended for headless mode.

## Installation

1. Clone or download the repository:
   ```
   git clone <repo-url>
   cd sportsbook-engine
   ```

2. Install dependencies:
   ```
   npm init -y
   npm install puppeteer-core nats dotenv
   ```

3. Set up environment variables (create `.env` file):
   ```
   USERNAME=your_sportsbook_username
   PASSWORD=your_sportsbook_password
   BASE_URL=https://example-sportsbook.com  # Sportsbook-specific base URL
   NATS_SERVERS=nats://localhost:4222        # NATS server(s)
   SPORTSBOOK_ID=default                     # Unique ID for this instance (e.g., 'bet365')
   ```

## Configuration

- **Sportsbook-Specific Tweaks**: Update selectors in class files (e.g., CSS selectors like `.balance`) to match the target site's DOM. Use `baseUrl` for navigation.
- **Headless Mode**: Set `headless: true` in `executor.js` for production.
- **Multiple Instances**: Run separate Node processes with different `SPORTSBOOK_ID` and `BASE_URL` env vars for parallelism.
- **NATS Subjects**: Bets are consumed from `bet.place.${SPORTSBOOK_ID}` and responses are sent back via the message reply mechanism.

## Usage

### Running the Engine

1. Start the engine (listens for NATS messages):
   ```
   node executor.js
   ```

   - It launches a browser, navigates to `BASE_URL`, logs in, and subscribes to NATS.
   - Browser stays open (non-headless by default) for debugging.

2. Send a Bet Request via NATS (example using `nats` CLI or client):
   ```
   nats pub "bet.place.default" '{"query":"Man City vs Arsenal","team":"Man City","stake":100}' --reply
   ```

   - Response: `{"success":true,"payout":150}` or error.

### Manual Testing

Uncomment the test block in `executor.js` for direct calls:
```javascript
const testParams = { query: "Man City vs Arsenal", team: "Man City", stake: 100 };
const result = await executor.placeBet(testParams);
console.log('Manual bet result:', result);
```

### Available Methods (via `SportsbookApp`)

- `launchApp()`: Navigates to the sportsbook home.
- `login(username, password)`: Logs in.
- `placeBet({ query, team, stake })`: Full bet flow (moneyline example).
- `viewLiveBets()`: Fetches live games.
- `manageAccount()`: Checks balance.

## Example Workflow

1. **Publisher Side** (e.g., another service): Publishes bet params to NATS subject `bet.place.${sportsbookId}`.
2. **Consumer (This Engine)**: Receives message, automates browser actions, places bet, computes payout, responds via NATS.
3. **Scaling**: Deploy 60+ Docker containers, each with unique `SPORTSBOOK_ID` and `BASE_URL`, sharing the same NATS cluster.

## Scalability Notes

- **Horizontal Scaling**: Each instance handles one sportsbook; use orchestration (e.g., Kubernetes) for 60+.
- **Performance**: Puppeteer is resource-intensive; limit to 1-2 tabs per instance. Use clustering for multi-core.
- **Reliability**: Add retries in methods (e.g., `page.waitForSelector`). Monitor NATS for backpressure.
- **Rate Limiting**: Implement delays between actions to avoid bans.

## Troubleshooting

- **Selector Errors**: Sites change DOM; inspect with DevTools and update CSS/XPath selectors.
- **NATS Connection**: Verify server with `nats sub "bet.place.*"`.
- **Puppeteer Crashes**: Use `--no-sandbox` args; ensure Chrome is accessible.
- **Login Fails**: Check env vars and CAPTCHA handling (not implemented; add if needed).

## Contributing

- Fork and PR for new modules or sportsbook adapters.
- Tests: Add Jest tests for classes (not included).

## License

MIT License. See `LICENSE` for details.

---

*Built with ❤️ for scalable betting automation. Last updated: October 03, 2025.*
