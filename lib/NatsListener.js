// lib/NatsListener.js
import { NATSBase } from './NatsBase.js';
import { ClusterManager } from './ClusterManager.js';
import logger from './logger.js';

export class NATSListener extends NATSBase {
  constructor(config, validConfigs, publisher) {
    super(config, validConfigs);
    if (!publisher?.publishReceivedAck) {
      throw new Error('NATSListener: publisher must implement publishReceivedAck');
    }
    this.publisher = publisher;
    this.receivedBetIDs = new Set();
    this.arbCycleStore = new Map();
  }

  async startListeners() {
    try {
      const subIncoming = this.nc.subscribe('bets.incoming');
      logger.info(`Subscribed to bets.incoming [${this.currentConfig.name}]`);
      this.handleIncomingBets(subIncoming);

      const subOtp = this.nc.subscribe('otp.updates');
      logger.info(`Subscribed to otp.updates [${this.currentConfig.name}]`);
      this.handleOtpMessages(subOtp);

      this.periodicCleanup();
    } catch (err) {
      logger.error('Failed to start listeners: ' + err.message);
      throw err;
    }
  }

  async handleIncomingBets(sub) {
    for await (const msg of sub) {
      try {
        if (!msg.data?.length) continue;

        const betRequest = this.decodeMessage(msg.data);
        if (!betRequest || typeof betRequest !== 'object') continue;

        // STEP 1: Is this bet for ANY valid bookie?
        if (!this.filterByBookie(betRequest)) continue;

        const { bet_id: incomingBetID, ...rawData } = betRequest;
        const r = this._normalizeRow(rawData);
        const bookie = r.bookie;

        // STEP 2: Is it for ME?
        if (bookie !== this.currentConfig.name) {
          continue; // Skip ACK
        }

        const isArb = r.arbcycle_id !== 'unknown';
        const generatedID = isArb
          ? this.generateArbBetID(r)
          : this.generateValueBetID(r);

        if (generatedID !== incomingBetID) {
          logger.warn(`BetID mismatch – expected ${generatedID}, got ${incomingBetID}`);
          continue;
        }

        if (this.receivedBetIDs.has(incomingBetID)) {
          logger.warn(`Duplicate bet ${incomingBetID}`);
          continue;
        }
        this.receivedBetIDs.add(incomingBetID);

        // ONLY WE ACK
        await this.publisher.publishReceivedAck(incomingBetID);

        const normalized = {
          ...rawData,
          BetID: incomingBetID,
          Bookie: bookie,
          BetType: isArb ? 'arb' : 'value',
        };

        if (isArb) {
          this.handleArbCycleBet(rawData, normalized);
        } else {
          logger.info(`Queueing value bet ${incomingBetID} for ${bookie}`);
          await ClusterManager.queueBet({
            config: this.currentConfig,
            betRequest: normalized,
            nc: this.nc,
          });
        }

      } catch (err) {
        logger.error(`handleIncomingBets error: ${err.message}`);
      }
    }
  }

  async handleOtpMessages(sub) {
    for await (const msg of sub) {
      try {
        if (!msg.data?.length) continue;
        const otp = this.decodeMessage(msg.data);
        if (!this.filterByBookie(otp)) continue;

        const { Bookie } = otp;
        if (Bookie !== this.currentConfig.name) continue;

        const { Otp, Status } = otp;
        if (!Otp) continue;

        ClusterManager.storeOtp(Bookie, { Otp, Status });
        logger.info(`Stored OTP for ${Bookie}`);
      } catch (e) {
        logger.error(`OTP error: ${e.message}`);
      }
    }
  }

  async handleArbCycleBet(rawData, normalized) {
    const ArbCycleID = rawData.arbcycle_id ?? rawData.ArbCycleID;
    if (!ArbCycleID) return;

    // OWNERSHIP: Only one listener processes
    const hash = ArbCycleID.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const ownerIndex = hash % this.validConfigs.length;
    if (this.validConfigs[ownerIndex].config.name !== this.currentConfig.name) {
      return;
    }

    if (!this.arbCycleStore.has(ArbCycleID)) {
      this.arbCycleStore.set(ArbCycleID, {
        bets: [],
        receivedAt: Date.now(),
        expectedBets: 2,
      });
    }

    const cycle = this.arbCycleStore.get(ArbCycleID);
    cycle.bets.push(normalized);

    if (cycle.bets.length >= cycle.expectedBets) {
      const hasOurBet = cycle.bets.some(b => b.Bookie === this.currentConfig.name);
      if (!hasOurBet) {
        logger.warn(`No bet for ${this.currentConfig.name} in ${ArbCycleID}`);
        this.arbCycleStore.delete(ArbCycleID);
        return;
      }

      logger.info(`Arb cycle ${ArbCycleID} complete – queuing [${this.currentConfig.name}]`);
      await ClusterManager.queueBet({
        config: this.currentConfig,
        betRequest: { ArbCycleID, bets: cycle.bets, BetType: 'arb' },
        nc: this.nc,
      });
      this.arbCycleStore.delete(ArbCycleID);
    }
  }

  periodicCleanup() {
    setInterval(() => {
      const now = Date.now();
      for (const [id, cycle] of this.arbCycleStore) {
        if (now - cycle.receivedAt > 30_000) {
          logger.warn(`Stale arb cycle ${id} – discarded`);
          this.arbCycleStore.delete(id);
        }
      }
    }, 10_000);
  }
}
