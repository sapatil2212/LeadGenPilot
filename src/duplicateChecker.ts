/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import path from "path";
import { Lead } from "./types";
import { logger } from "./logger";
import { readJson, writeJsonAtomic } from "./storage";

const filePath = path.join(process.cwd(), "processed-leads.json");

/**
 * Normalizes a string by lowercasing and removing non-alphanumeric chars for robust lookup
 */
function createKey(name: string, address: string): string {
  const cleanName = (name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const cleanAddress = (address || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${cleanName}_${cleanAddress}`;
}

export const duplicateChecker = {
  /**
   * Loads all previously processed leads from file
   */
  loadLeads: (): Lead[] => {
    return readJson<Lead[]>(filePath, []);
  },

  /**
   * Checks if a lead has already been processed based on Name + Address key
   */
  isDuplicate: (name: string, address: string): boolean => {
    const leads = duplicateChecker.loadLeads();
    const targetKey = createKey(name, address);
    
    return leads.some(lead => createKey(lead.businessName, lead.address) === targetKey);
  },

  /**
   * Adds and saves a new processed lead to the end of the file
   */
  saveLead: (lead: Lead): void => {
    const leads = duplicateChecker.loadLeads();
    
    // Check if it's already in the local array to prevent file-level duplicates
    const leadKey = createKey(lead.businessName, lead.address);
    const exists = leads.some(l => createKey(l.businessName, l.address) === leadKey);
    
    if (!exists) {
      leads.push(lead);
      try {
        writeJsonAtomic(filePath, leads);
        logger.info(`Lead saved locally: ${lead.businessName}`);
      } catch (error) {
        logger.error(`Failed to save lead ${lead.businessName} to processed-leads.json`, error);
      }
    }
  }
};
