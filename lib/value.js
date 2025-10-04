// value.js
import winston from "winston";

// Logger configuration (shared with executor.js)
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

export class ArbitrageBetting {
  constructor(sportsbooks) {
    this.sportsbooks = sportsbooks;
  }

  async findArbitrageOpportunity(event, bet_type) {
    try {
      const odds = await this.getOddsFromSportsbooks(event, bet_type);
      const arbitragePercentage = this.calculateArbitragePercentage(odds);
      if (arbitragePercentage < 1) {
        logger.info(`Arbitrage opportunity found for event ${event.id} with bet_type ${bet_type}: ${arbitragePercentage * 100}%`);
        return { isOpportunity: true, odds };
      }
      logger.info(`No arbitrage opportunity for event ${event.id} with bet_type ${bet_type}: ${arbitragePercentage * 100}%`);
      return { isOpportunity: false, odds: null };
    } catch (error) {
      logger.error(`Error finding arbitrage opportunity for event ${event.id} with bet_type ${bet_type}: ${error.message}`);
      throw error;
    }
  }

  async getOddsFromSportsbooks(event, bet_type) {
    try {
      const oddsPromises = this.sportsbooks.map(async (sportsbook) => {
        const odds = await sportsbook.getOdds(event, bet_type);
        return { sportsbook, odds };
      });
      return await Promise.all(oddsPromises);
    } catch (error) {
      logger.error(`Error fetching odds for event ${event.id} with bet_type ${bet_type}: ${error.message}`);
      throw error;
    }
  }

  calculateArbitragePercentage(odds) {
    return odds.reduce((sum, { odds }) => sum + (1 / odds), 0);
  }

  async placeArbitrageBets(event, odds, bet_type) {
    try {
      const betAmounts = this.calculateBetAmounts(odds);
      const betResults = [];
      for (let i = 0; i < odds.length; i++) {
        const { sportsbook, odds: odd } = odds[i];
        try {
          const result = await sportsbook.placeBet(event, odd, betAmounts[i], bet_type);
          betResults.push({ sportsbook: sportsbook.name, success: true, betId: result.betId });
          logger.info(`Bet placed on ${sportsbook.name} for event ${event.id} with bet_type ${bet_type}: ${betAmounts[i]}`);
        } catch (error) {
          betResults.push({ sportsbook: sportsbook.name, success: false, error: error.message });
          logger.error(`Failed to place bet on ${sportsbook.name} for event ${event.id} with bet_type ${bet_type}: ${error.message}`);
        }
      }
      return betResults;
    } catch (error) {
      logger.error(`Error placing arbitrage bets for event ${event.id} with bet_type ${bet_type}: ${error.message}`);
      throw error;
    }
  }

  calculateBetAmounts(odds) {
    const totalArbitrage = 1 / odds.reduce((sum, { odds }) => sum + (1 / odds), 0);
    return odds.map(({ odds }) => totalArbitrage / (1 / odds));
  }
}

export class ValueBetting {
  constructor(sportsbooks) {
    this.sportsbooks = sportsbooks;
  }

  async findValueBets(event, bet_type) {
    try {
      const odds = await this.getOddsFromSportsbooks(event, bet_type);
      const trueProbability = await this.getTrueProbability(event);
      const valueBets = [];
      for (let i = 0; i < odds.length; i++) {
        const { sportsbook, odds: odd } = odds[i];
        const ev = this.calculateExpectedValue(odd, trueProbability);
        if (ev > 0) {
          valueBets.push({ sportsbook, odds: odd, ev });
          logger.info(`Value bet found on ${sportsbook.name} for event ${event.id} with bet_type ${bet_type}: EV=${ev}`);
        }
      }
      return valueBets;
    } catch (error) {
      logger.error(`Error finding value bets for event ${event.id} with bet_type ${bet_type}: ${error.message}`);
      throw error;
    }
  }

  async getOddsFromSportsbooks(event, bet_type) {
    try {
      const oddsPromises = this.sportsbooks.map(async (sportsbook) => {
        const odds = await sportsbook.getOdds(event, bet_type);
        return { sportsbook, odds };
      });
      return await Promise.all(oddsPromises);
    } catch (error) {
      logger.error(`Error fetching odds for event ${event.id} with bet_type ${bet_type}: ${error.message}`);
      throw error;
    }
  }

  async getTrueProbability(event) {
    // Placeholder: Integrate with an external service or model
    logger.warn(`Using dummy probability for event ${event.id}`);
    return 0.55; // Replace with actual probability service
  }

  calculateExpectedValue(odds, trueProbability) {
    const probabilityOfLosing = 1 - trueProbability;
    return (trueProbability * odds) - probabilityOfLosing;
  }

  async placeValueBets(valueBets, bet_type) {
    const betResults = [];
    for (const { sportsbook, odds, ev } of valueBets) {
      try {
        const result = await sportsbook.placeBet(odds, ev, bet_type); // Note: event is not passed here in original, but if needed, adjust
        betResults.push({ sportsbook: sportsbook.name, success: true, betId: result.betId });
        logger.info(`Value bet placed on ${sportsbook.name} with bet_type ${bet_type}: EV=${ev}`);
      } catch (error) {
        betResults.push({ sportsbook: sportsbook.name, success: false, error: error.message });
        logger.error(`Failed to place value bet on ${sportsbook.name} with bet_type ${bet_type}: ${error.message}`);
      }
    }
    return betResults;
  }
}
