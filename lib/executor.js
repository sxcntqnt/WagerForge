// executor.js
import puppeteer from "puppeteer-core";
import { connect, StringCodec } from "nats";
import dotenv from "dotenv";
import { readFileSync } from "fs";
import yaml from "js-yaml";
import winston from "winston";
import { SportsbookApp } from "./SportsbookApp.js"; // Assume this is implemented
import { ArbitrageBetting, ValueBetting } from "./value.js";

// Configure logger
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "logs/executor.log" })
  ]
});

const VALID_BET_TYPES = ["moneyline", "spread", "totals"];

class Executor {
  constructor() {
    this.config = this.loadConfig();
    this.sportsbooks = this.initializeSportsbooks();
    this.validateSportsbooks();
  }

  loadConfig() {
    try {
      const configFile = readFileSync("./config.yaml", "utf8");
      const config = yaml.load(configFile);
      if (!config.sportsbooks || !Array.isArray(config.sportsbooks)) {
        throw new Error("Invalid config: 'sportsbooks' must be an array");
      }
      return config;
    } catch (error) {
      logger.error(`Failed to load config: ${error.message}`);
      throw error;
    }
  }

  initializeSportsbooks() {
    return this.config.sportsbooks.map((sbConfig) => {
      try {
        this.validateSportsbookConfig(sbConfig);
        return new SportsbookApp({
          name: sbConfig.name,
          baseUrl: sbConfig.base_url,
          browserPath: sbConfig.browser_path,
          username: sbConfig.username,
          password: sbConfig.password,
          region: sbConfig.region,
          selectors: sbConfig.selectors
        });
      } catch (error) {
        logger.error(`Failed to initialize sportsbook ${sbConfig.name}: ${error.message}`);
        throw error;
      }
    });
  }

  validateSportsbookConfig(config) {
    const requiredFields = ["name", "base_url", "browser_path", "username", "password", "region", "selectors"];
    const requiredSelectors = ["login", "event_search", "odds_selector", "bet_button", "bet_history", "live_betting"];
    const requiredLoginFields = ["username_input", "password_input", "login_button"];
    const requiredEventSearchFields = ["sport_dropdown", "date_picker", "search_button"];
    const requiredOddsSelectorFields = ["moneyline", "spread", "totals"];
    const requiredLiveBettingFields = ["live_event", "in_play_bet_button"];

    for (const field of requiredFields) {
      if (!config[field]) {
        throw new Error(`Missing required field '${field}' in sportsbook config`);
      }
    }

    for (const selector of requiredSelectors) {
      if (!config.selectors[selector]) {
        throw new Error(`Missing required selector '${selector}' in sportsbook config`);
      }
    }

    for (const loginField of requiredLoginFields) {
      if (!config.selectors.login[loginField]) {
        throw new Error(`Missing required login selector '${loginField}'`);
      }
    }

    for (const searchField of requiredEventSearchFields) {
      if (!config.selectors.event_search[searchField]) {
        throw new Error(`Missing required event_search selector '${searchField}'`);
      }
    }

    for (const oddsField of requiredOddsSelectorFields) {
      if (!config.selectors.odds_selector[oddsField]) {
        throw new Error(`Missing required odds_selector field '${oddsField}'`);
      }
    }

    for (const liveField of requiredLiveBettingFields) {
      if (!config.selectors.live_betting[liveField]) {
        throw new Error(`Missing required live_betting selector '${liveField}'`);
      }
    }

    if (!config.selectors.bet_button) {
      throw new Error("Missing required selector 'bet_button'");
    }

    if (!config.selectors.bet_history) {
      throw new Error("Missing required selector 'bet_history'");
    }
  }

  validateSportsbooks() {
    if (!this.sportsbooks || this.sportsbooks.length === 0) {
      throw new Error("No valid sportsbooks initialized");
    }
    this.sportsbooks.forEach((sb, index) => {
      if (!sb.name || typeof sb.getOdds !== "function" || typeof sb.placeBet !== "function") {
        throw new Error(`Invalid sportsbook at index ${index}`);
      }
    });
  }

  async handleArbOrValueBet(event, bet_type) {
    try {
      if (!event || !event.id) {
        throw new Error("Invalid event data");
      }
      if (!VALID_BET_TYPES.includes(bet_type)) {
        throw new Error(`Invalid bet_type '${bet_type}'. Must be one of: ${VALID_BET_TYPES.join(", ")}`);
      }

      const arbBetting = new ArbitrageBetting(this.sportsbooks);
      const valueBetting = new ValueBetting(this.sportsbooks);

      // Check for arbitrage opportunities
      const { isOpportunity, odds } = await arbBetting.findArbitrageOpportunity(event, bet_type);
      if (isOpportunity) {
        logger.info(`Placing arbitrage bets for event ${event.id} with bet_type ${bet_type}`);
        const results = await arbBetting.placeArbitrageBets(event, odds, bet_type);
        return { type: "arbitrage", bet_type, results };
      }

      // If no arbitrage, check for value bets
      const valueBets = await valueBetting.findValueBets(event, bet_type);
      if (valueBets.length > 0) {
        logger.info(`Placing value bets for event ${event.id} with bet_type ${bet_type}`);
        const results = await valueBetting.placeValueBets(valueBets, bet_type);
        return { type: "value", bet_type, results };
      }

      logger.info(`No betting opportunities found for event ${event.id} with bet_type ${bet_type}`);
      return { type: "none", bet_type, results: [] };
    } catch (error) {
      logger.error(`Error handling bets for event ${event.id} with bet_type ${bet_type}: ${error.message}`);
      throw error;
    }
  }

  async initialize() {
    try {
      for (const sportsbook of this.sportsbooks) {
        await sportsbook.initialize();
        logger.info(`Initialized sportsbook ${sportsbook.name}`);
      }
    } catch (error) {
      logger.error(`Failed to initialize sportsbooks: ${error.message}`);
      throw error;
    }
  }
}

// NATS Consumer
(async () => {
  try {
    const executor = new Executor();
    await executor.initialize();

    const nc = await connect({ servers: process.env.NATS_SERVERS || "nats://localhost:4222" });
    const sc = StringCodec();
    const betSubject = "bet.place";

    logger.info(`Listening for bet requests on ${betSubject}`);
    const betSub = nc.subscribe(betSubject);

    for await (const msg of betSub) {
      try {
        const data = JSON.parse(sc.decode(msg.data));
        if (!data.event || !data.event.id) {
          logger.error("Invalid bet request data: missing event or event.id");
          msg.respond(sc.encode(JSON.stringify({ success: false, error: "Invalid event data" })));
          continue;
        }
        const bet_type = data.bet_type || "moneyline"; // Default to "moneyline" if not provided
        if (!VALID_BET_TYPES.includes(bet_type)) {
          logger.error(`Invalid bet_type in request: ${bet_type}`);
          msg.respond(sc.encode(JSON.stringify({ success: false, error: `Invalid bet_type '${bet_type}'` })));
          continue;
        }

        const result = await executor.handleArbOrValueBet(data.event, bet_type);
        msg.respond(sc.encode(JSON.stringify({ success: true, ...result })));
        logger.info(`Bet processed for event ${data.event.id} with bet_type ${bet_type}: ${result.type}`);
      } catch (error) {
        logger.error(`Error processing bet request: ${error.message}`);
        msg.respond(sc.encode(JSON.stringify({ success: false, error: error.message })));
      }
    }
  } catch (error) {
    logger.error(`Failed to start NATS consumer: ${error.message}`);
    process.exit(1);
  }
})();

 
