// lib/NATSListener.js

import { connect, StringCodec } from 'nats';
import logger from './logger.js';
import { ClusterManager } from './ClusterManager.js';

export class NATSListener {
  constructor(config) {
    this.sc = StringCodec();
    this.arbCycleStore = new Map();
    this.ackStore = new Map();
    this.returnsStore = new Map();
    this.nc = null;
    this.currentConfig = config;
  }

  async connect() {
    try {
      this.nc = await connect({ servers: 'nats://localhost:4222' });
      logger.info('Connected to NATS server');
      await this.startListeners();
    } catch (err) {
      logger.error('Failed to connect to NATS: ' + err.message);
      throw err;
    }
  }

  async startListeners() {
    try {
      const subIncoming = this.nc.subscribe('bets.incoming');
      logger.info('Subscribed to bets.incoming');
      this.handleIncomingBets(subIncoming);

      const subAck = this.nc.subscribe('*.ack');
      logger.info('Subscribed to *.ack');
      this.handleAckMessages(subAck);

      const subReturns = this.nc.subscribe('*.returns');
      logger.info('Subscribed to *.returns');
      this.handleReturnMessages(subReturns);

      this.periodicCleanup();
    } catch (err) {
      logger.error('Failed to start NATS listeners: ' + err.message);
      throw err;
    }
  }

  async handleIncomingBets(subIncoming) {
    for await (const msg of subIncoming) {
      try {
        const betRequest = JSON.parse(this.sc.decode(msg.data));
        logger.info(`Received bet request: ${JSON.stringify(betRequest)}`);

        if (!this.currentConfig) {
          logger.error('No valid config found. Ignoring bet request.');
          continue;
        }

        const { BetType, ArbCycleID, BetID, Bookie } = betRequest;

        if (!BetID || !Bookie) {
          logger.error('Missing BetID or Bookie. Ignoring bet request.');
          continue;
        }

        if (BetType === 'value') {
          logger.info(`Processing value bet: ${BetID} for ${Bookie}`);
          await ClusterManager.queueBet({
            config: this.currentConfig,
            betRequest,
            nc: this.nc,
          });
        } else if (BetType === 'arb') {
          if (!ArbCycleID) {
            logger.error('Missing ArbCycleID for arb bet. Ignoring bet request.');
            continue;
          }

          if (!this.arbCycleStore.has(ArbCycleID)) {
            this.arbCycleStore.set(ArbCycleID, {
              bets: [],
              receivedAt: Date.now(),
              expectedBets: 2, // Adjust as needed
            });
          }

          const cycle = this.arbCycleStore.get(ArbCycleID);
          cycle.bets.push(betRequest);

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
            logger.info(`Waiting for more bets for ArbCycleID: ${ArbCycleID}. Received ${cycle.bets.length}/${cycle.expectedBets}`);
          }
        } else {
          logger.error(`Invalid BetType: ${BetType}. Ignoring bet request.`);
        }
      } catch (err) {
        logger.error(`Failed to process bet request: ${err.message}`);
      }
    }
  }

  async handleAckMessages(subAck) {
    for await (const msg of subAck) {
      try {
        const ack = JSON.parse(this.sc.decode(msg.data));
        const bookie = msg.subject.split('.')[0];
        logger.info(`Received ack from ${bookie}: ${JSON.stringify(ack)}`);

        const { ArbCycleID, BetID, Status } = ack;

        if (!BetID) {
          logger.error(`Missing BetID in ack from ${bookie}. Ignoring.`);
          continue;
        }

        if (ArbCycleID) {
          if (!this.ackStore.has(ArbCycleID)) {
            this.ackStore.set(ArbCycleID, {
              acks: [],
              receivedAt: Date.now(),
              expectedAcks: 2,
            });
          }

          const cycle = this.ackStore.get(ArbCycleID);
          cycle.acks.push({ ...ack, Bookie: bookie });

          if (cycle.acks.length >= cycle.expectedAcks) {
            logger.info(`Received all acks for ArbCycleID: ${ArbCycleID}`);
            const allSuccessful = cycle.acks.every((a) => a.Status === 'Success');

            if (allSuccessful) {
              logger.info(`Arb cycle ${ArbCycleID} successfully placed across bookies`);
            } else {
              logger.warn(`Arb cycle ${ArbCycleID} incomplete. Some bets failed.`);
              cycle.acks
                .filter((a) => a.Status === 'Success')
                .forEach((a) =>
                  this.nc.publish(`${a.Bookie}.cancel`, this.sc.encode(JSON.stringify({ BetID: a.BetID, ArbCycleID })))
                );
            }

            this.ackStore.delete(ArbCycleID);
          } else {
            logger.info(`Waiting for more acks for ArbCycleID: ${ArbCycleID}. Received ${cycle.acks.length}/${cycle.expectedAcks}`);
          }
        } else {
          logger.info(`Received ack for value bet ${BetID} from ${bookie}: ${Status}`);
          if (Status !== 'Success') {
            logger.warn(`Value bet ${BetID} failed at ${bookie}: ${ack.Error || 'Unknown error'}`);
          }
        }
      } catch (err) {
        logger.error(`Failed to process ack: ${err.message}`);
      }
    }
  }

  async handleReturnMessages(subReturns) {
    for await (const msg of subReturns) {
      try {
        const returnData = JSON.parse(this.sc.decode(msg.data));
        const bookie = msg.subject.split('.')[0];
        logger.info(`Received return from ${bookie}: ${JSON.stringify(returnData)}`);

        const { ArbCycleID, BetID, Result, Return, Stake } = returnData;

        if (!BetID) {
          logger.error(`Missing BetID in return from ${bookie}. Ignoring.`);
          continue;
        }

        if (ArbCycleID) {
          if (!this.returnsStore.has(ArbCycleID)) {
            this.returnsStore.set(ArbCycleID, {
              returns: [],
              receivedAt: Date.now(),
              expectedReturns: 2,
            });
          }

          const cycle = this.returnsStore.get(ArbCycleID);
          cycle.returns.push({ ...returnData, Bookie: bookie });

          if (cycle.returns.length >= cycle.expectedReturns) {
            logger.info(`Received all returns for ArbCycleID: ${ArbCycleID}`);
            const totalInvested = cycle.returns.reduce((sum, r) => sum + (r.Stake || 0), 0);
            const totalReturn = cycle.returns.reduce((sum, r) => sum + (r.Return || 0), 0);
            const profit = totalReturn - totalInvested;
            logger.info(`Arb cycle ${ArbCycleID} profit/loss: ${profit}`);
            this.returnsStore.delete(ArbCycleID);
          } else {
            logger.info(`Waiting for more returns for ArbCycleID: ${ArbCycleID}. Received ${cycle.returns.length}/${cycle.expectedReturns}`);
          }
        } else {
          logger.info(`Received return for value bet ${BetID} from ${bookie}: ${Result}, Return: ${Return}`);
          const stake = Stake || 0;
          const profit = Return - stake;
          logger.info(`Value bet ${BetID} profit/loss: ${profit}`);
        }
      } catch (err) {
        logger.error(`Failed to process return: ${err.message}`);
      }
    }
  }

  periodicCleanup() {
    setInterval(() => {
      const now = Date.now();
      const timeoutMs = 30_000;

      const cleanupStore = (store, storeName) => {
        for (const [id, entry] of store.entries()) {
          if (now - entry.receivedAt > timeoutMs) {
            logger.warn(`Timeout for ${id} in ${storeName}. Items received: ${entry.bets?.length || entry.acks?.length || entry.returns?.length}`);
            store.delete(id);
          }
        }
      };

      cleanupStore(this.arbCycleStore, 'arbCycleStore');
      cleanupStore(this.ackStore, 'ackStore');
      cleanupStore(this.returnsStore, 'returnsStore');
    }, 10_000);
  }

  async close() {
    if (this.nc) {
      await this.nc.close().catch(e => logger.warn(`Error closing NATS: ${e.message}`));
      logger.info('NATS connection closed');
    }
  }
}

