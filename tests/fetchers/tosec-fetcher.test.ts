/**
 * Tests for TosecFetcher — scraping logic and ZIP/DAT parsing
 *
 * @intent Verify that version detection and download URL extraction work against
 *         real-shape HTML from tosecdev.org, without making actual network requests
 * @guarantee No real network calls — fetch() is always mocked
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TosecFetcher } from '../../src/fetchers/tosec-fetcher.js';
import { VersionTracker } from '../../src/core/version-tracker.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds minimal HTML that mimics the tosecdev.org downloads category listing.
 * Includes category links with date-based slugs.
 */
function makeDownloadsPageHtml(dates: string[]): string {
  const links = dates
    .map(d => `<a href="/downloads/category/22-${d}">TOSEC ${d}</a>`)
    .join('\n');
  return `<html><body><div class="categories">${links}</div></body></html>`;
}

/**
 * Builds minimal HTML that mimics a TOSEC category page containing a download link.
 */
function makeCategoryPageHtml(downloadId: string, filename: string): string {
  return `
    <html><body>
      <a href="/downloads/category/22-2024-05-17?download=${downloadId}:${filename}">
        Download ${filename}
      </a>
    </body></html>
  `;
}

// ─── checkRemoteVersion ───────────────────────────────────────────────────────

describe('TosecFetcher.checkRemoteVersion', () => {
  let fetcher: TosecFetcher;
  let mockTracker: VersionTracker;

  beforeEach(() => {
    mockTracker = {
      read: vi.fn().mockReturnValue(null),
      write: vi.fn().mockResolvedValue(undefined),
      getLastChecked: vi.fn().mockReturnValue(null),
      saveArtifactHashes: vi.fn().mockResolvedValue(undefined),
      getArtifactHashes: vi.fn().mockResolvedValue({}),
    } as unknown as VersionTracker;

    fetcher = new TosecFetcher(mockTracker, './output/tosec');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the most recent date from the downloads page', async () => {
    const html = makeDownloadsPageHtml(['2023-08-01', '2024-05-17', '2022-03-10']);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => html,
    }));

    const version = await fetcher.checkRemoteVersion();
    expect(version).toBe('2024-05-17');
  });

  it('returns the only date when there is one category', async () => {
    const html = makeDownloadsPageHtml(['2024-01-15']);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => html,
    }));

    const version = await fetcher.checkRemoteVersion();
    expect(version).toBe('2024-01-15');
  });

  it('throws when the page returns a non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    }));

    await expect(fetcher.checkRemoteVersion()).rejects.toThrow('503');
  });

  it('throws when no date categories are found in the HTML', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><body>No categories here</body></html>',
    }));

    await expect(fetcher.checkRemoteVersion()).rejects.toThrow(
      'Could not find TOSEC release categories'
    );
  });
});

// ─── shouldSkip ───────────────────────────────────────────────────────────────

describe('TosecFetcher.shouldSkip', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true when remote version matches stored version', async () => {
    const mockTracker = {
      read: vi.fn().mockReturnValue({ version: '2024-05-17', lastChecked: new Date().toISOString() }),
      write: vi.fn(),
      getLastChecked: vi.fn(),
      saveArtifactHashes: vi.fn(),
      getArtifactHashes: vi.fn(),
    } as unknown as VersionTracker;

    const fetcher = new TosecFetcher(mockTracker, './output/tosec');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => makeDownloadsPageHtml(['2024-05-17']),
    }));

    const skip = await fetcher.shouldSkip();
    expect(skip).toBe(true);
  });

  it('returns false when remote version is newer', async () => {
    const mockTracker = {
      read: vi.fn().mockReturnValue({ version: '2023-01-01', lastChecked: new Date().toISOString() }),
      write: vi.fn(),
      getLastChecked: vi.fn(),
      saveArtifactHashes: vi.fn(),
      getArtifactHashes: vi.fn(),
    } as unknown as VersionTracker;

    const fetcher = new TosecFetcher(mockTracker, './output/tosec');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => makeDownloadsPageHtml(['2024-05-17']),
    }));

    const skip = await fetcher.shouldSkip();
    expect(skip).toBe(false);
  });

  it('returns false when no stored version exists', async () => {
    const mockTracker = {
      read: vi.fn().mockReturnValue(null),
      write: vi.fn(),
      getLastChecked: vi.fn(),
      saveArtifactHashes: vi.fn(),
      getArtifactHashes: vi.fn(),
    } as unknown as VersionTracker;

    const fetcher = new TosecFetcher(mockTracker, './output/tosec');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => makeDownloadsPageHtml(['2024-05-17']),
    }));

    const skip = await fetcher.shouldSkip();
    expect(skip).toBe(false);
  });
});
