/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Lead } from "./types";

/**
 * Calculatess the Lead Score (out of 100) based on criteria:
 * - No Website: +50
 * - Reviews > 100: +20
 * - Rating > 4.5: +20
 * - Phone Exists: +10
 */
export function calculateLeadScore(lead: Omit<Lead, "leadScore" | "dateAdded">): number {
  let score = 0;

  // 1. No Website configuration (+50)
  if (lead.websiteMissing || !lead.website || lead.website.trim() === "") {
    score += 50;
  }

  // 2. Reviews count > 100 (+20)
  if (lead.reviews > 100) {
    score += 20;
  }

  // 3. Rating grade > 4.5 (+20)
  if (lead.rating > 4.5) {
    score += 20;
  }

  // 4. Phone number exists (+10)
  if (lead.phone && lead.phone.trim() !== "" && lead.phone.toLowerCase() !== "not found") {
    score += 10;
  }

  return score;
}
