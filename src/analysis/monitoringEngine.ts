/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Monitoring engine — persists scan snapshots per business and detects changes
 * between scans (website added/removed, rating/review movement, social activity,
 * digital-presence score movement). Uses the existing atomic JSON storage.
 */

import path from "path";
import { readJson, writeJsonAtomic } from "../storage";
import { GrowthIntelligence } from "./types";

export interface ScanSnapshot {
  key: string; // stable id: businessName|address
  businessName: string;
  scannedAt: string;
  hasWebsite: boolean;
  rating: number;
  reviews: number;
  overallScore: number;
  socialActive: number; // count of active social profiles
}

export interface ScanChange {
  key: string;
  businessName: string;
  changes: string[];
  previousScannedAt: string;
  currentScannedAt: string;
}

const HISTORY_PATH = path.join(process.cwd(), "scan-history.json");

interface HistoryFile {
  [key: string]: ScanSnapshot[];
}

export function makeBusinessKey(businessName: string, address: string): string {
  return `${(businessName || "").trim().toLowerCase()}|${(address || "").trim().toLowerCase()}`;
}

function loadHistory(): HistoryFile {
  return readJson<HistoryFile>(HISTORY_PATH, {});
}

function saveHistory(history: HistoryFile): void {
  writeJsonAtomic(HISTORY_PATH, history);
}

/** Build a snapshot from a growth-intelligence result + core business facts. */
export function buildSnapshot(params: {
  businessName: string;
  address: string;
  hasWebsite: boolean;
  rating: number;
  reviews: number;
  intel: GrowthIntelligence;
}): ScanSnapshot {
  const socialActive = params.intel.social?.profiles.filter((p) => p.status === "ACTIVE").length ?? 0;
  return {
    key: makeBusinessKey(params.businessName, params.address),
    businessName: params.businessName,
    scannedAt: params.intel.analyzedAt,
    hasWebsite: params.hasWebsite,
    rating: params.rating,
    reviews: params.reviews,
    overallScore: params.intel.scorecard?.overallScore ?? 0,
    socialActive,
  };
}

/**
 * Record a snapshot and return any detected changes versus the previous scan.
 * The full history is retained (capped) so trends can be charted later.
 */
export function recordScan(snapshot: ScanSnapshot, maxPerBusiness = 20): ScanChange | null {
  const history = loadHistory();
  const prevList = history[snapshot.key] || [];
  const previous = prevList.length ? prevList[prevList.length - 1] : null;

  const change = previous ? diffSnapshots(previous, snapshot) : null;

  const nextList = [...prevList, snapshot].slice(-maxPerBusiness);
  history[snapshot.key] = nextList;
  saveHistory(history);

  return change;
}

/** Return the stored history for a business (oldest → newest). */
export function getHistory(businessName: string, address: string): ScanSnapshot[] {
  const history = loadHistory();
  return history[makeBusinessKey(businessName, address)] || [];
}

function diffSnapshots(prev: ScanSnapshot, curr: ScanSnapshot): ScanChange | null {
  const changes: string[] = [];

  if (!prev.hasWebsite && curr.hasWebsite) changes.push("Website added");
  if (prev.hasWebsite && !curr.hasWebsite) changes.push("Website removed");

  if (curr.reviews > prev.reviews) changes.push(`New reviews (+${curr.reviews - prev.reviews})`);
  if (curr.rating !== prev.rating) changes.push(`Rating changed ${prev.rating} → ${curr.rating}`);

  if (curr.socialActive > prev.socialActive) changes.push("Increased social activity");
  if (curr.socialActive < prev.socialActive) changes.push("Decreased social activity");

  if (curr.overallScore > prev.overallScore + 3) changes.push(`Digital presence improved (${prev.overallScore} → ${curr.overallScore})`);
  if (curr.overallScore < prev.overallScore - 3) changes.push(`Digital presence declined (${prev.overallScore} → ${curr.overallScore})`);

  if (changes.length === 0) return null;
  return {
    key: curr.key,
    businessName: curr.businessName,
    changes,
    previousScannedAt: prev.scannedAt,
    currentScannedAt: curr.scannedAt,
  };
}
