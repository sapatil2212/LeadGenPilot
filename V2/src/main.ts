/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import dotenv from "dotenv";
import { runScraper } from "./mapsScraper";
import { logger } from "./logger";

// Boot dotenv context keys
dotenv.config();

/**
 * CLI Entrance point for LeadGenPilot Agent
 */
async function main() {
  logger.clear();
  logger.log("=================================================");
  logger.log("         LEADGENPILOT - SCRAPER BOT              ");
  logger.log("=================================================");
  
  try {
    const result = await runScraper();
    logger.log(`Process exited successfully. Found ${result.leads.length} qualified leads.`);
    process.exit(0);
  } catch (error) {
    logger.error("A critical unhandled exception stopped the CLI Scraper process.", error);
    process.exit(1);
  }
}

main();
