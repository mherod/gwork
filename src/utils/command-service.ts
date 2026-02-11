/**
 * Shared command service utilities for initializing services.
 * Extracted from duplicated initialization logic across command handlers.
 */

/**
 * Generic helper to ensure a service is initialized.
 * Works with any service that has an initialize() method.
 *
 * @param service - The service instance to initialize (must have initialize() method)
 */
export async function ensureInitialized<T extends { initialize(): Promise<void> }>(
  service: T
): Promise<void> {
  await service.initialize();
}
