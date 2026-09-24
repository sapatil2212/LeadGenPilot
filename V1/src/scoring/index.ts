/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Public surface of the scoring module.
 */

export {
  BUILT_IN_HOT_THRESHOLD,
  BUILT_IN_MAX,
  BUILT_IN_RULES,
  BUILT_IN_RULE_SET_NAME,
  BUILT_IN_WARM_THRESHOLD,
  RULE_LIMITS,
  RuleSetValidationError,
  builtInRuleSet,
  computeMaxScore,
  evaluate,
  parseRules,
  parseThresholds,
  type LeadPriority,
  type RuleSetDefinition,
  type ScoreContribution,
  type ScoreResult,
  type ScoringRule,
} from "./ruleSet";

export {
  SIGNALS,
  getSignal,
  isKnownSignal,
  listSignals,
  type ScorableLead,
  type SignalCategory,
  type SignalDefinition,
  type SignalListing,
} from "./signals";

export {
  createRuleSet,
  deleteRuleSet,
  getRuleSet,
  listRuleSets,
  resolveActiveRuleSet,
  scoreLead,
  scoreLeadForTenant,
  setDefaultRuleSet,
  toDefinition,
  updateRuleSet,
  type RuleSetInput,
  type RuleSetView,
} from "./scoringService";
