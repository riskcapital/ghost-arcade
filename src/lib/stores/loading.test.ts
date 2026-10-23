import { describe, expect, it, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  backgroundLoad,
  beginOwnedLoading,
  continueLoadingInBackground,
  endOwnedLoading,
  hideLoading,
  loadingCanBackground,
  loadingMessage,
  showLoading,
  updateOwnedLoading,
} from './loading';

describe('loading overlay', () => {
  beforeEach(() => {
    hideLoading();
  });

  it('offers the background button for file loads only', () => {
    showLoading('Loading Composition...');
    expect(get(loadingCanBackground)).toBe(false);
    const owner = beginOwnedLoading('Loading scan.ply', 0, 'Reading source data');
    expect(get(loadingCanBackground)).toBe(true);
    endOwnedLoading(owner);
    expect(get(loadingMessage)).toBeNull();
    expect(get(loadingCanBackground)).toBe(false);
  });

  it('closes the overlay and keeps reporting the load in the chip', () => {
    const owner = beginOwnedLoading('Loading scan.ply', 0.05, 'Reading source data');
    continueLoadingInBackground();
    expect(get(loadingMessage)).toBeNull();
    expect(get(backgroundLoad)).toMatchObject({ message: 'Loading scan.ply', progress: 0.05, others: 0 });

    updateOwnedLoading(owner, 'Loading scan.ply', 0.5, 'Parsing points');
    expect(get(loadingMessage)).toBeNull();
    expect(get(backgroundLoad)).toMatchObject({ progress: 0.5, detail: 'Parsing points' });

    endOwnedLoading(owner);
    expect(get(backgroundLoad)).toBeNull();
    expect(get(loadingMessage)).toBeNull();
  });

  it('sends every load in flight to the background at once', () => {
    const a = beginOwnedLoading('Loading a.ply');
    const b = beginOwnedLoading('Loading b.ply');
    continueLoadingInBackground();
    expect(get(backgroundLoad)).toMatchObject({ message: 'Loading b.ply', others: 1 });
    // The earlier load reports in the background instead of reopening the overlay.
    updateOwnedLoading(a, 'Loading a.ply', 0.3);
    expect(get(loadingMessage)).toBeNull();
    endOwnedLoading(b);
    expect(get(backgroundLoad)).toMatchObject({ message: 'Loading a.ply', progress: 0.3, others: 0 });
    endOwnedLoading(a);
    expect(get(backgroundLoad)).toBeNull();
  });

  it('shows the overlay again for a load started later', () => {
    const a = beginOwnedLoading('Loading a.ply');
    continueLoadingInBackground();
    const b = beginOwnedLoading('Loading b.ply');
    expect(get(loadingMessage)).toBe('Loading b.ply');
    endOwnedLoading(b);
    expect(get(loadingMessage)).toBeNull();
    expect(get(backgroundLoad)).toMatchObject({ message: 'Loading a.ply' });
    endOwnedLoading(a);
    // Ending twice is harmless.
    endOwnedLoading(a);
    expect(get(backgroundLoad)).toBeNull();
  });
});
