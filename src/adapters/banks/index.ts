/**
 * Built-in bank adapter configurations.
 *
 * To add a new bank:
 * 1. Create a new file in this directory (e.g., citi.ts)
 * 2. Export a BankAdapterConfig constant
 * 3. Re-export it from this index file
 * 4. Register it in createDefaultRegistry() in ../registry.ts
 */

export { chaseAdapter } from './chase';
export { bankOfAmericaAdapter } from './bank-of-america';
export { wellsFargoAdapter } from './wells-fargo';
