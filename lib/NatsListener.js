// lib/NatsListener.js
import { NATSBase } from './NatsBase.js';
import { NATSPublisher } from './NatsPublisher.js';
import { ClusterManager } from './ClusterManager.js';
import logger from './logger.js';

/**
 * NATSListener – receives bets.incoming & otp.updates
 * The only change from your original file is the **normalisation + validation**
 * step that now mirrors Python 1-to-1.
 */
export class NATSListener extends NATSBase {
  constructor(config, validConfigs) {
    super(config, validConfigs);
    this.validConfigs = validConfigs;
  }

  // -----------------------------------------------------------------------
  // Public entry point – start both subscriptions
  // -----------------------------------------------------------------------
  async startListeners() {
    try {
      const subIncoming = this.nc.subscribe('bets.incoming');
      logger.info('Subscribed to bets.incoming');
      this.handleIncomingBets(subIncoming);

      const subOtp = this.nc.subscribe('otp.updates');
      logger.info('Subscribed to otp.updates');
      this.handleOtpMessages(subOtp);

      this.periodicCleanup();
    } catch (err) {
      logger.error('Failed to start NATS listeners: ' + err.message);
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // bets.incoming – the heart of the validation
  // -----------------------------------------------------------------------
  async handleIncomingBets(subIncoming) {
    for await (const msg of subIncoming) {
      try {
        // ---- raw payload -------------------------------------------------
        logger.info(
          `Raw NATS message: subject=${msg.subject}, length=${msg.data.length}, hex=${msg.data
            .toString('hex')
            .slice(0, 120)}...`
        );

        if (!msg.data || msg.data.length === 0) {
          logger.error('Received empty NATS message. Ignoring.');
          continue;
        }

        // ---- decode ------------------------------------------------------
        const betRequest = this.decodeMessage(msg.data);
        logger.info(`Decoded betRequest: ${JSON.stringify(betRequest, null, 2)}`);

        if (!betRequest || typeof betRequest !== 'object') {
          logger.error('Invalid betRequest object. Ignoring.');
          continue;
        }

        // ---- bookie filter ------------------------------------------------
        if (!this.filterByBookie(betRequest, this.validConfigs)) {
          continue;
        }

        // ---- split out the fields we need -------------------------------
        const { bet_id: incomingBetID, ...rawData } = betRequest;

        // ---- NORMALISE EXACTLY LIKE PYTHON -------------------------------
        const r = this._normalizeRow(rawData);
        const Bookie = r.bookie || r.Bookie || rawData.bookie || 'unknown';
        // ---- decide arb vs value -----------------------------------------
        const isArb = r.arbcycle_id !== 'unknown';
        const generatedBetID = isArb
          ? this.generateArbBetID(r)
          : this.generateValueBetID(r);

        // ---- VALIDATE ----------------------------------------------------
        if (generatedBetID !== incomingBetID) {
          logger.warn(
            `Invalid BetID for ${Bookie}: expected=${generatedBetID}, got=${incomingBetID}. Ignoring.`
          );
          continue;
        }

        // ---- duplicate guard ---------------------------------------------
        if (this.receivedBetIDs.has(incomingBetID)) {
          logger.warn(`Duplicate bet ${incomingBetID} detected. Ignoring.`);
          continue;
        }
        this.receivedBetIDs.add(incomingBetID);

        // ---- ACK ---------------------------------------------------------
        NATSPublisher.publishBetAck(incomingBetID, this.nc, this);

        // ---- build the object we hand to the rest of the system ----------
        const normalizedBetRequest = {
          ...rawData,               // original fields (still useful downstream)
          BetID: incomingBetID,
          Bookie,
          BetType: isArb ? 'arb' : 'value',
        };

        // ---- route -------------------------------------------------------
        if (isArb) {
          this.handleArbCycleBet(rawData, normalizedBetRequest);
        } else {
          logger.info(`Processing value bet ${incomingBetID} for ${Bookie}`);
          await ClusterManager.queueBet({
            config: this.currentConfig,
            betRequest: normalizedBetRequest,
            nc: this.nc,
          });
        }
      } catch (err) {
        logger.error(`Failed to process bet request: ${err.message}. Raw length=${msg.data.length}`);
      }
    }
  }

  // -----------------------------------------------------------------------
  // OTP handling – unchanged (just kept for completeness)
  // -----------------------------------------------------------------------
  async handleOtpMessages(subOtp) {
    for await (const msg of subOtp) {
      try {
        const otpData = this.decodeMessage(msg.data);
        logger.info(`Received OTP update: ${JSON.stringify(otpData)}`);

        if (!this.filterByBookie(otpData)) continue;

        const { Bookie, Otp } = otpData;
        if (!Bookie || !Otp) {
          logger.error(`Missing required fields in OTP update: Bookie=${Bookie}, Otp=${Otp}`);
          continue;
        }

        ClusterManager.storeOtp(Bookie, { Otp, Status: otpData.Status });
        logger.info(`Stored OTP for ${Bookie}`);
      } catch (err) {
        logger.error(`Failed to process OTP update: ${err.message}`);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Arb-cycle collection – unchanged (only tiny tweak to use rawData)
  // -----------------------------------------------------------------------
  async handleArbCycleBet(rawData, normalizedBetRequest) {
    const ArbCycleID = rawData.arbcycle_id ?? rawData.ArbCycleID;
    if (!ArbCycleID) {
      logger.error(`Missing ArbCycleID for arb bet. Ignoring.`);
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
    cycle.bets.push(normalizedBetRequest);

    if (cycle.bets.length >= cycle.expectedBets) {
      logger.info(`Collected all bets for ArbCycleID: ${ArbCycleID}`);
      await ClusterManager.queueBet({
        config: this.currentConfig,
        betRequest: {
          ArbCycleID,
          bets: cycle.bets,
          BetType: 'arb',
        },
        nc: this.nc,
      });
      this.arbCycleStore.delete(ArbCycleID);
    } else {
      logger.info(
        `Waiting for more bets for ArbCycleID: ${ArbCycleID}. Received ${cycle.bets.length}/${cycle.expectedBets}`
      );
    }
  }
}
