import { NomadLocator, NomadConfig } from "@nomad-xyz/configuration";
import * as dotenv from 'dotenv';
import { DeployContext } from "../../deploy/src/DeployContext";
import * as ethers from 'ethers';
import { NonceManager } from "@ethersproject/experimental";
import fs from 'fs';
import bunyan from 'bunyan';
// import { Key } from './key';
import { NomadDomain } from './domain';
import { Agents } from "./agent";
import { HardhatNetwork } from "./network";
import { BridgeContext } from '@nomad-xyz/sdk-bridge';
import { NomadContext } from '@nomad-xyz/sdk';

if (!fs.existsSync('../../.env')) dotenv.config({path: __dirname + '/../.env.example'})
else dotenv.config();

export class NomadEnv {
    domains: NomadDomain[];
    governor: NomadLocator;
    bridgeSDK: BridgeContext;
    coreSDK: NomadContext;

    log = bunyan.createLogger({name: 'localenv'});

    constructor(governor: NomadLocator) {
        this.domains = [];
        this.governor = governor;
        this.bridgeSDK = new BridgeContext(this.nomadConfig());
        this.coreSDK = new NomadContext(this.nomadConfig());
    }

    // Adds a network to the array of networks if it's not already there.
    addDomain(d: NomadDomain) {
        if (!this.domains.includes(d)) this.domains.push(d);
    }
    
    // Gets governing network
    get govNetwork(): NomadDomain {
        const d = this.domains.find(d => d.network.domainNumber === this.governor.domain);
        if (!d) throw new Error(`Governing network is not present. GovDomain ${this.governor.domain}, present network domains: ${this.domains.map(d => d.network.domainNumber).join(', ')}`);
        return d;
    }

    getCoreSDK(): NomadContext {
        if (!this.coreSDK) throw new Error(`No core SDK`);
        return this.coreSDK;
    }
  
    getBridgeSDK(): BridgeContext {
        if (!this.bridgeSDK) throw new Error(`No bridge SDK`);
        return this.bridgeSDK;
    }

    async deployFresh(): Promise<void> {
        console.log(`Deploying!`, JSON.stringify(this.nomadConfig(), null, 4));

        const deployContext = this.setDeployContext();

        const outputDir = './output';
        const governanceBatch = await deployContext.deployAndRelinquish();
        console.log(`Deployed! gov batch:`, governanceBatch);
        await this.outputConfigAndVerification(outputDir, deployContext);
        await this.outputCallBatch(outputDir, deployContext);
    }

    async deploy(): Promise<void> {
        if (this.deployedOnce()) {

         //TODO: INPUT RESUME DEPLOYMENT LOGIC HERE

        } else {
                this.deployFresh()
        }
    }

    outputConfigAndVerification(outputDir: string, deployContext: DeployContext) {
        // output the config
        fs.mkdirSync(outputDir, {recursive: true});
        fs.writeFileSync(
            `${outputDir}/test_config.json`,
            JSON.stringify(deployContext.data, null, 2),
        );
        // if new contracts were deployed,
        const verification = Object.fromEntries(deployContext.verification);
        if (Object.keys(verification).length > 0) {
          // output the verification inputs
          fs.writeFileSync(
              `${outputDir}/verification-${Date.now()}.json`,
              JSON.stringify(verification, null, 2),
          );
        }
    }

    async outputCallBatch(outputDir: string, deployContext: DeployContext) {
        const governanceBatch = deployContext.callBatch;
        if (!governanceBatch.isEmpty()) {
          // build & write governance batch
          await governanceBatch.build();
          fs.writeFileSync(
              `${outputDir}/governanceTransactions.json`,
              JSON.stringify(governanceBatch, null, 2),
          );
        }
      }

    async check(): Promise<void> {
        await this.deployContext.checkDeployment();
        console.log(`CHECKS PASS!`);
    }

    //@TODO Feature: switches after contracts exist
    deployedOnce(): boolean {
        return false;
    }

    get deployerKey(): string {
        const DEPLOYERKEY = ``+ process.env.PRIVATE_KEY + ``;
        if (!DEPLOYERKEY) {
            throw new Error('Add DEPLOYER_PRIVATE_KEY to .env');
        }
        return DEPLOYERKEY;
    }

   getDomains(): NomadDomain[] {
        return Array.from(this.domains.values());
   }

   setDeployContext(): DeployContext {
        //@TODO remove re-initialization.
        const deployContext = new DeployContext(this.nomadConfig());
        // add deploy signer and overrides for each network
        for (const domain of this.domains) {
            const name = domain.network.name;
            const provider = deployContext.mustGetProvider(name);
            const wallet = new ethers.Wallet(this.deployerKey, provider);
            const signer = new NonceManager(wallet);
            deployContext.registerSigner(name, signer);
            deployContext.overrides.set(name, domain.network.deployOverrides);
        }
        return deployContext;
    }

    get deployContext(): DeployContext{
        return this.deployContext;
    }

    nomadConfig(): NomadConfig {
        return {
            version: 0,
            environment: 'local',
            networks: this.domains.map(d => d.network.name),
            rpcs: Object.fromEntries(this.domains.map(d => [d.network.name, d.rpcs])),
            agent: Object.fromEntries(this.domains.map(d => [d.network.name, d.agentConfig])),
            protocol: {governor: this.governor, networks: Object.fromEntries(this.domains.map(d => [d.network.name, d.domain]))},
            core: Object.fromEntries(this.domains.filter(d => d.network.isDeployed).map(d => [d.network.name, d.network.coreContracts!])),
            bridge: Object.fromEntries(this.domains.filter(d => d.network.isDeployed).map(d => [d.network.name, d.network.bridgeContracts!])),
            bridgeGui: Object.fromEntries(this.domains.filter(d => d.network.isDeployed).map(d => [d.network.name, d.network.bridgeGui!])),
            gas: Object.fromEntries(this.domains.map(d => [d.network.name, d.gasConfig!])),
        }
    }


  async upAgents(d: NomadDomain, metricsPort: number) {
    d.agents = new Agents(d, metricsPort);
    await d.agents.relayer.connect();
    d.agents.relayer.start();
    await d.agents.updater.connect();
    d.agents.updater.start();
    await d.agents.processor.connect();
    d.agents.processor.start();
    await d.agents.kathy.connect();
    d.agents.kathy.start();
    for (const watcher of d.agents.watchers) {
      await watcher.connect();
      watcher.start();
    }
  }

  async stopAgents(d: NomadDomain) {
    d.agents!.relayer.stop();
    d.agents!.updater.stop();
    d.agents!.processor.stop();
    d.agents!.kathy.stop();
    for (const watcher of d.agents!.watchers) {
      watcher.stop();
    }
  }
}

(async () => {

    // Ups 2 new hardhat test networks tom and jerry to represent home chain and target chain.
    const log = bunyan.createLogger({name: 'localenv'});

    // Instantiate HardhatNetworks
    const t = new HardhatNetwork('tom', 1);
    const j = new HardhatNetwork('jerry', 2);

    // Instantiate Nomad domains
    const tDomain = new NomadDomain(t);
    const jDomain = new NomadDomain(j);

    // Await domains to up networks.
    await Promise.all([
        tDomain.network.up(),
        jDomain.network.up(),
    ])

    log.info(`Upped Tom and Jerry`);

    const le = new NomadEnv({domain: tDomain.network.domainNumber, id: '0x'+'20'.repeat(20)});

    le.addDomain(tDomain);
    le.addDomain(jDomain);
    log.info(`Added Tom and Jerry`);

    tDomain.connectNetwork(jDomain);
    jDomain.connectNetwork(tDomain);
    log.info(`Connected Tom and Jerry`);

    // Notes, check governance router deployment on Jerry and see if that's actually even passing
    // ETHHelper deployment may be failing because of lack of governance router, either that or lack of wETH address.

    await Promise.all([
        t.setWETH(t.deployWETH()),
        j.setWETH(j.deployWETH())
    ])

    log.info(await le.deploy());

    // let myContracts = le.deploymyproject();

    await le.upAgents(tDomain, 9080);
    await le.upAgents(jDomain, 9090);
    log.info(`Agents up`);

})()