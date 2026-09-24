/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Review analyzer — mines review text for positive topics, complaints,
 * keywords and overall sentiment. Uses a lightweight lexicon-based approach so
 * it works with zero external API dependency; when no review text is available
 * it derives a coarse sentiment from the star rating.
 */

import { ReviewAnalysis } from "./types";

const POSITIVE_WORDS = [
  "great", "excellent", "amazing", "friendly", "professional", "clean", "helpful",
  "recommend", "best", "wonderful", "polite", "caring", "quick", "affordable",
  "knowledgeable", "comfortable", "satisfied", "love", "good", "trustworthy",
];
const NEGATIVE_WORDS = [
  "rude", "dirty", "expensive", "slow", "late", "waiting", "worst", "bad",
  "unprofessional", "poor", "disappointed", "overpriced", "crowded", "delay",
  "unhelpful", "cancelled", "misdiagnosed", "avoid", "terrible", "horrible",
];
const TOPIC_KEYWORDS = [
  "service", "staff", "doctor", "treatment", "price", "cost", "cleanliness",
  "appointment", "waiting", "parking", "location", "quality", "results", "support",
];

const STOPWORDS = new Set([
  "the", "and", "was", "for", "are", "but", "with", "you", "this", "that", "very",
  "they", "have", "had", "not", "were", "our", "their", "from", "all", "here",
]);

export function analyzeReviews(reviewTexts: string[], rating: number): ReviewAnalysis {
  const texts = (reviewTexts || []).map((t) => (t || "").toLowerCase()).filter(Boolean);

  if (texts.length === 0) {
    // Fall back to rating-derived sentiment.
    const sentimentScore = Math.round(Math.max(0, Math.min(100, (rating / 5) * 100)));
    const summary =
      rating >= 4.5
        ? "Strong star rating suggests high customer satisfaction, though detailed review text was unavailable."
        : rating >= 3.5
        ? "Moderate star rating; review text unavailable for deeper sentiment mining."
        : "Below-average rating indicates potential reputation issues; review text unavailable.";
    return {
      positiveTopics: [],
      complaints: [],
      keywords: [],
      sentimentSummary: summary,
      suggestedImprovements:
        rating < 4
          ? ["Actively request reviews from satisfied customers.", "Respond to negative reviews to rebuild trust."]
          : ["Maintain service quality and keep requesting fresh reviews."],
      sentimentScore,
    };
  }

  const blob = texts.join(" ");
  const wordCounts = new Map<string, number>();
  for (const w of blob.split(/[^a-z]+/)) {
    if (w.length < 4 || STOPWORDS.has(w)) continue;
    wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
  }

  const count = (words: string[]) => words.filter((w) => blob.includes(w));
  const positiveHits = count(POSITIVE_WORDS);
  const negativeHits = count(NEGATIVE_WORDS);

  const positiveTopics = TOPIC_KEYWORDS.filter(
    (t) => blob.includes(t) && positiveHits.length >= negativeHits.length
  ).slice(0, 6);
  const complaints = negativeHits.slice(0, 6).map((w) => capitalize(w));

  const keywords = Array.from(wordCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w);

  const posScore = positiveHits.length;
  const negScore = negativeHits.length;
  const total = posScore + negScore || 1;
  const sentimentScore = Math.round(((posScore / total) * 0.6 + (rating / 5) * 0.4) * 100);

  const sentimentSummary =
    sentimentScore >= 70
      ? "Customers are largely positive, frequently praising service and staff."
      : sentimentScore >= 45
      ? "Mixed sentiment: positives are offset by recurring complaints worth addressing."
      : "Sentiment skews negative; multiple recurring complaints need attention.";

  const suggestedImprovements: string[] = [];
  if (negativeHits.some((w) => ["waiting", "slow", "late", "delay"].includes(w)))
    suggestedImprovements.push("Reduce wait times with online booking and queue management.");
  if (negativeHits.some((w) => ["expensive", "overpriced", "cost", "price"].includes(w)))
    suggestedImprovements.push("Communicate pricing transparently and highlight value.");
  if (negativeHits.some((w) => ["rude", "unprofessional", "unhelpful"].includes(w)))
    suggestedImprovements.push("Invest in front-desk customer-service training.");
  if (suggestedImprovements.length === 0)
    suggestedImprovements.push("Keep requesting reviews and reply to every review to reinforce trust.");

  return { positiveTopics, complaints, keywords, sentimentSummary, suggestedImprovements, sentimentScore };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
