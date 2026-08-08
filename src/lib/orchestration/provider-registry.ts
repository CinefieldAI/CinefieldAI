import "server-only";
import { OrchestrationError } from "./errors";
import { cloudflareWorkersAiProvider } from "./providers/cloudflare-workers-ai-provider";
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
 * Registers the offline mock provider, the fal.ai adapter, and the
 * Cloudflare Workers AI adapter. Each provider appears exactly once; adding
 * a model to an already-registered provider is a model-registry change, not
 * a provider-registry one. Cloudflare AI Gateway ("cloudflare-ai-gateway")
 * is deliberately never registered here — it is a transport/gateway layer,
 * not a provider of record.
 */

const PROVIDERS: ReadonlyMap<string, ProviderAdapter> = new Map<string, ProviderAdapter>([
  [mockProvider.providerId, mockProvider],
  [falProvider.providerId, falProvider],
  [cloudflareWorkersAiProvider.providerId, cloudflareWorkersAiProvider],
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
