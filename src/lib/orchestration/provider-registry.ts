import "server-only";
import { OrchestrationError } from "./errors";
import { falProvider } from "./providers/fal-provider";
import { mockProvider } from "./providers/mock-provider";
import type { ProviderAdapter } from "./providers/provider-adapter";

/**
 * Cinefield provider registry.
 *
 * Only providers registered here can execute. There is deliberately no
 * fallback behavior: an unregistered provider raises PROVIDER_NOT_CONFIGURED
 * rather than quietly resolving to the mock provider (or vice versa).
 *
 * Registers the offline mock provider and the fal.ai adapter. Each provider
 * appears exactly once; adding a fal model is a model-registry change, not a
 * provider-registry one.
 */

const PROVIDERS: ReadonlyMap<string, ProviderAdapter> = new Map<string, ProviderAdapter>([
  [mockProvider.providerId, mockProvider],
  [falProvider.providerId, falProvider],
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
