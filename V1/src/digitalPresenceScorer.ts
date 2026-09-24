/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Compatibility shim over the configurable scoring engine.
 *
 * This file used to hold the scoring rules themselves: a fixed function awarding
 * 50 points for "has no website", 15 for "no Instagram", and grading HOT at an
 * absolute 100 points against a maximum nobody had worked out. Those weights
 * describe prospects for a web design agency, which made the product unusable for
 * anyone selling something else.
 *
 * Phase 4 moved the rules into src/scoring/, where they are tenant-owned data.
 * The built-in rule set reproduces the numbers below exactly, so this signature
 * survives for the call sites that only want a score and a band, and
 * tests/digitalPresenceScorer.test.ts — written against the original
 * implementation and deliberately left unedited — is the proof that the engine
 * grades identically.
 *
 * New code should call src/scoring/index.ts `scoreLead` instead, which returns
 * the achievable maximum and the per-rule breakdown. Those are what make a score
 * explainable, and they are the reason the AI prompt can finally be told the
 * right denominator.
 */

import { evaluate, builtInRuleSet, type LeadPriority } from "./scoring/ruleSet";
import type { ScorableLead } from "./scoring/signals";

export interface ScoreDetails {
  score: number;
  priority: LeadPriority;
}

/**
 * Scores a lead with the built-in rule set.
 *
 * @deprecated Prefer `scoreLead` from src/scoring, which also reports the
 * maximum and the breakdown. Kept because the CLI entry point and the
 * characterization tests depend on this exact shape.
 */
export function calculateDigitalPresenceScore(lead: ScorableLead): ScoreDetails {
  const result = evaluate(lead, builtInRuleSet());
  return { score: result.score, priority: result.priority };
}
