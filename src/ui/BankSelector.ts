/**
 * Bank Selection UI Component — searchable list with bank logos.
 *
 * This is a headless UI component that provides the logic for
 * bank selection without depending on React Native or any UI framework.
 *
 * Invariants:
 * 1. filteredBanks is always a subset of allBanks
 * 2. selectedBank (if set) is always in filteredBanks
 * 3. query changes always trigger re-filtering
 * 4. Selection is cleared when selected bank is no longer visible
 */

import type { BankAdapterSummary, AdapterSearchOptions } from '../adapters/types';
import type { BankAdapterRegistry } from '../adapters/registry';

// ─── State Types ─────────────────────────────────────────────────────

/**
 * The complete state of the bank selector UI.
 */
export interface BankSelectorState {
  /** Current search query */
  readonly query: string;
  /** All available banks (unfiltered) */
  readonly allBanks: readonly BankAdapterSummary[];
  /** Banks matching the current query/filters */
  readonly filteredBanks: readonly BankAdapterSummary[];
  /** Currently selected bank, if any */
  readonly selectedBank: BankAdapterSummary | null;
  /** Whether a search is in progress */
  readonly isSearching: boolean;
}

/**
 * Callback for state changes.
 */
export type BankSelectorListener = (state: BankSelectorState) => void;

// ─── Bank Selector Controller ────────────────────────────────────────

/**
 * Headless controller for bank selection UI.
 */
export class BankSelectorController {
  private state: BankSelectorState;
  private readonly listeners: Set<BankSelectorListener> = new Set();
  private readonly registry: BankAdapterRegistry;

  constructor(registry: BankAdapterRegistry) {
    this.registry = registry;
    const allBanks = registry.list();
    this.state = {
      query: '',
      allBanks,
      filteredBanks: allBanks,
      selectedBank: null,
      isSearching: false,
    };
  }

  /** Get the current state snapshot. */
  getState(): BankSelectorState {
    return this.state;
  }

  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(listener: BankSelectorListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Update the search query and re-filter banks. */
  setQuery(query: string): void {
    const trimmed = query.trim();
    if (trimmed === this.state.query) return;

    const options: AdapterSearchOptions = {
      query: trimmed.length > 0 ? trimmed : undefined,
    };

    const filteredBanks = this.registry.search(options);

    const selectedStillVisible =
      this.state.selectedBank !== null &&
      filteredBanks.some((b: BankAdapterSummary) => b.bankId === this.state.selectedBank?.bankId);

    this.setState({
      query: trimmed,
      filteredBanks,
      selectedBank: selectedStillVisible ? this.state.selectedBank : null,
      isSearching: trimmed.length > 0,
    });
  }

  /** Select a bank by bankId. Returns true if found. */
  select(bankId: string): boolean {
    const bank = this.state.filteredBanks.find((b: BankAdapterSummary) => b.bankId === bankId);
    if (!bank) return false;
    this.setState({ selectedBank: bank });
    return true;
  }

  /** Clear the current selection. */
  clearSelection(): void {
    if (this.state.selectedBank === null) return;
    this.setState({ selectedBank: null });
  }

  /** Reset the selector to initial state. */
  reset(): void {
    this.setState({
      query: '',
      filteredBanks: this.state.allBanks,
      selectedBank: null,
      isSearching: false,
    });
  }

  /** Dispose of the controller and clear all listeners. */
  dispose(): void {
    this.listeners.clear();
  }

  private setState(partial: Partial<BankSelectorState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}
