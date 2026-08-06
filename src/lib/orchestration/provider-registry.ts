import "server-only";
import { OrchestrationError } from "./errors";
import { mockProvider } from "./providers/mock-provider";
import type { ProviderAdapter } from "./providers/provider-adapter";

/**
 * Cinefield provider registry.
 *
 * Only providers registered here can execute. There is deliberately no
 * fallback behavior: an unregistered provider raises PROVIDER_NOT_CONFIGURED
 * rather than quietly resolving to the mock provider (or vice versa).
 *
 * This phase registers only "mock". Real adapters are added in a later phase.
 */

const PROVIDERS: ReadonlyMap<string, ProviderAdapter> = new Map<string, ProviderAdapter>([
  [mockProvider.providerId, mockProvider],
]);

export function getProviderAdapter(providerId: string): ProviderAdapter {
  const adapter = PROVIDERS.get(providerId);
  if (!adapter) {
    throw new OrchestrationError("PROVIDER_NOT_CONFIGURED", {
      context: { providerId },
    });
  }
  return adapter;
}

export function isProviderRegistered(providerId: string): boolean {
  return PROVIDERS.has(providerId);
}

export function listRegisteredProviders(): string[] {
  return [...PROVIDERS.keys()];
}
