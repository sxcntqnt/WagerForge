// executor.js
import puppeteer from "puppeteer-core";
import { connect, StringCodec } from "nats";
import dotenv from "dotenv";
import { SportsbookApp } from "./SportsbookApp.js";

dotenv.config();

class Executor {
  constructor() {
    this.browser = null;
    this.page = null;
    this.app = null;
    this.nc = null;

    this.username = process.env.USERNAME;
    this.password = process.env.PASSWORD;
    this.baseUrl = process.env.BASE_URL || 'https://example-sportsbook.com';
    this.natsServers = process.env.NATS_SERVERS || 'nats://localhost:4222';
    this.sportsbookId = process.env.SPORTSBOOK_ID || 'default';
  }

  async initialize() {
    this.browser = await puppeteer.launch({
      headless: false, // set to true for headless
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1080, height: 1024 });
    
    // Create app instance with page and baseUrl
    this.app = new SportsbookApp({ page: this.page, baseUrl: this.baseUrl });
  }

  async navigateTo(url) {
    if (!this.page) throw new Error("Browser not initialized");
    await this.page.goto(url);
  }

  async close() {
    await this.browser?.close();
    await this.nc?.close();
  }

  // Expose app methods
  async launchApp() {
    await this.app.launchApp();
  }

  async login(username, password) {
    await this.app.login(username || this.username, password || this.password);
  }

  async placeBet(params) {
    return await this.app.placeBet(params);
  }

  async viewLiveBets() {
    await this.app.viewLiveBets();
  }

  async manageAccount() {
    await this.app.manageAccount();
  }

  async startNatsConsumer() {
    this.nc = await connect({ servers: this.natsServers });
    const sc = StringCodec();
    const subject = `bet.place.${this.sportsbookId}`;
    const sub = this.nc.subscribe(subject);
    console.log(`Listening for bet requests on ${subject}...`);

    (async () => {
      for await (const m of sub) {
        try {
          const data = sc.decode(m.data);
          const params = JSON.parse(data);
          console.log(`Received bet request: ${JSON.stringify(params)}`);
          const result = await this.app.placeBet(params);
          m.respond(sc.encode(JSON.stringify({ success: true, ...result })));
          console.log(`Replied with success: ${JSON.stringify({ success: true, ...result })}`);
        } catch (e) {
          console.error(`Error processing bet: ${e.message}`);
          m.respond(sc.encode(JSON.stringify({ success: false, error: e.message })));
        }
      }
    })();

    // Keep the connection alive
    await this.nc.closed();
  }
}

(async () => {
  const executor = new Executor();

  await executor.initialize();
  await executor.launchApp();
  await executor.login(); // Uses env vars

  // Start NATS consumer as the main loop
  await executor.startNatsConsumer();

  // For testing manually, uncomment below:
  // const testParams = { query: "Man City vs Arsenal", team: "Man City", stake: 100 };
  // const result = await executor.placeBet(testParams);
  // console.log('Manual bet result:', result);

  // await executor.close();
})();
