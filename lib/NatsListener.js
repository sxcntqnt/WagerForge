// lib/NATSListener.js

import { NATSBase } from './NatsBase.js';
import { NATSPublisher } from './NatsPublisher.js';
import { ClusterManager } from './ClusterManager.js';
import logger from './logger.js';
import crypto from 'crypto';

export class NATSListener extends NATSBase {
  constructor(config,  validConfigs) {
    super(config);
    this.validConfigs = validConfigs;
  }

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

  async handleIncomingBets(subIncoming) {
    for await (const msg of subIncoming) {
      try {
        logger.info(
          `Raw NATS message: subject=${msg.subject}, length=${msg.data.length}, hex=${msg.data.toString('hex')}`
        );

        if (!msg.data || msg.data.length === 0) {
          logger.error('Received empty NATS message. Ignoring.');
          continue;
        }

        const betRequest = this.decodeMessage(msg.data);
        logger.info(
          `Decoded betRequest: ${JSON.stringify(betRequest, (k, v) =>
            typeof v === 'bigint' ? v.toString() : v, 2)}`
        );

        if (!betRequest || typeof betRequest !== 'object') {
          logger.error('Invalid betRequest object. Ignoring.');
          continue;
        }

        // Filter by bookie
        if (!this.filterByBookie(betRequest,this.validConfigs)) {
          continue;
        }

        const {
          bet_id: BetID,
          bookie: Bookie,
          data = {},
        } = betRequest;

        const {
          arbcycle_id: ArbCycleID,
          match_id,
          team,
          side,
          odds,
          win_rate,
          ev,
          strategy,
          search_query,
          home_team,
          away_team,
          risk,
          timestamp,
          eventId,
          stake,
          placed = false,
          hit,
          payout,
          profit,
          outcome,
        } = data;

        if (!Bookie || !match_id || !team || !eventId || !search_query || !stake) {
          logger.error(
            `Missing required fields: Bookie=${Bookie}, match_id=${match_id}, team=${team}, eventId=${eventId}, search_query=${search_query}, stake=${stake}`
          );
          continue;
        }

        if (!this.validateBetID(betRequest)) {
          logger.warn(
            `Invalid BetID for ${Bookie}: expected=${crypto
              .createHash('sha256')
              .update(`${Bookie}-${team}-${match_id}`)
              .digest('hex')}, got=${BetID}. Ignoring.`
          );
          continue;
        }

        if (this.receivedBetIDs.has(BetID)) {
          logger.warn(`Duplicate bet ${BetID} detected. Ignoring.`);
          continue;
        }
        this.receivedBetIDs.add(BetID);

        NATSPublisher.publishBetAck(BetID, this.nc, this);

        const normalizedBetRequest = {
          BetID,
          Bookie,
          ArbCycleID: ArbCycleID || undefined,
          match_id,
          team,
          side,
          odds,
          win_rate,
          ev,
          strategy,
          search_query,
          home_team,
          away_team,
          risk,
          timestamp: timestamp || new Date().toISOString(),
          eventId,
          stake,
          placed,
          hit,
          payout,
          profit,
          outcome,
          BetType: ArbCycleID ? 'arb' : 'value',
        };

        const BetType = ArbCycleID ? 'arb' : 'value';

        if (BetType === 'arb') {
          if (!ArbCycleID) {
            logger.error(`Missing ArbCycleID for arb bet. Ignoring.`);
            continue;
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
        } else {
          logger.info(`Processing value bet ${BetID} for ${Bookie}`);
          await ClusterManager.queueBet({
            config: this.currentConfig,
            betRequest: normalizedBetRequest,
            nc: this.nc,
          });
        }
      } catch (err) {
        logger.error(
          `Failed to process bet request: ${err.message}. Raw data length=${msg.data.length}`
        );
      }
    }
  }

  async handleOtpMessages(subOtp) {
    for await (const msg of subOtp) {
      try {
        const otpData = this.decodeMessage(msg.data);
        logger.info(`Received OTP update: ${JSON.stringify(otpData)}`);

        // Filter by bookie
        if (!this.filterByBookie(otpData)) {
          continue;
        }

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
}
