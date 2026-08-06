import "server-only";
import { GoogleGenAI } from "@google/genai";

const PLACEHOLDER_VALUE = "KEYI_BURAYA_YAZ";

/**
 * Server-only Gemini client factory. Never import this file from a client
 * component — `GEMINI_API_KEY` must only ever be read via process.env on
 * the server, never as a NEXT_PUBLIC_ variable.
 */

let cachedClient: GoogleGenAI | null = null;

export function isGeminiConfigured(): boolean {
  const apiKey = process.env.GEMINI_API_KEY;
  return Boolean(apiKey) && apiKey !== PLACEHOLDER_VALUE;
}

/** Throws GEMINI_NOT_CONFIGURED if the key is missing, empty, or still the placeholder. */
export function getGeminiClient(): GoogleGenAI {
  if (!isGeminiConfigured()) {
    throw new Error("GEMINI_NOT_CONFIGURED");
  }
  if (!cachedClient) {
    cachedClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return cachedClient;
}
