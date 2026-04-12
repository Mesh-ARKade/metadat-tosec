/**
 * TosecFetcher - Fetcher for TOSEC DATs from tosecdev.org
 *
 * @intent Fetch TOSEC DAT packs from tosecdev.org using Playwright browser automation
 * @guarantee Downloads ZIP files, extracts DATs, tracks version by date
 */

import { chromium, type Browser, type Page } from 'playwright';
import type { DAT } from '../types/index.js';
import { AbstractFetcher } from '../base/base-fetcher.js';
import { VersionTracker } from '../core/version-tracker.js';

export class TosecFetcher extends AbstractFetcher {
  private browser: Browser | null = null;
  private sourceName: string = 'tosec';

  constructor(versionTracker: VersionTracker) {
    super(versionTracker, { maxRetries: 3, retryDelay: 5000 });
  }

  /**
   * Get the source name
   */
  getSourceName(): string {
    return this.sourceName;
  }

  /**
   * Check the remote version (date) from tosecdev.org
   */
  async checkRemoteVersion(): Promise<string> {
    const page = await this.getPage();
    
    try {
      // Navigate to the downloads page
      await page.goto('https://www.tosecdev.org/downloads/category/22-datfiles', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // Find the latest release date from the page
      // TOSEC uses dates in format YYYY-MM-DD in their download links
      const dateMatch = await page.evaluate(() => {
        // Look for date pattern in the page
        const links = Array.from(document.querySelectorAll('a[href*="/downloads/"]'));
        for (const link of links) {
          const href = link.getAttribute('href') || '';
          // Match patterns like /2025-01-15/ or tosec-v2025-01-15
          const match = href.match(/(\d{4}-\d{2}-\d{2})/);
          if (match) return match[1];
        }
        return null;
      });

      if (!dateMatch) {
        throw new Error('Could not find version date on TOSEC downloads page');
      }

      return dateMatch;
    } finally {
      // Don't close browser here - reuse it
    }
  }

  /**
   * Fetch DATs from tosecdev.org
   * @param onEntry Optional callback for streaming entries during fetch
   */
  async fetchDats(onEntry?: (dat: DAT) => void): Promise<DAT[]> {
    const dats: DAT[] = [];
    const page = await this.getPage();

    try {
      // Navigate to the downloads page
      await page.goto('https://www.tosecdev.org/downloads/category/22-datfiles', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // Get all the download links from the page
      const downloadLinks = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href*="/downloads/"]'));
        return links
          .map((link) => ({
            href: link.getAttribute('href'),
            text: link.textContent,
          }))
          .filter((l) => l.href && l.href.endsWith('.zip'));
      });

      for (const link of downloadLinks) {
        const dat: DAT = {
          id: link.href || `tosec-${Date.now()}`,
          source: this.sourceName,
          system: 'unknown',
          datVersion: 'unknown',
          roms: [],
          name: link.text?.trim() || 'Unknown',
          description: link.href || '',
          category: 'unknown',
          format: 'unknown',
        };
        dats.push(dat);
        if (onEntry) onEntry(dat);
      }

      return dats;
    } finally {
      // Don't close - reuse
    }
  }

  /**
   * Get or create a Playwright page
   */
  private async getPage(): Promise<Page> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true });
    }

    const context = await this.browser.newContext();
    return context.newPage();
  }

  /**
   * Clean up browser resources
   */
  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Capture screenshot on error using context
   */
  async captureErrorScreenshot(outputPath: string, context: any): Promise<void> {
    const pages = context?.pages();
    if (pages && pages.length > 0) {
      await pages[0].screenshot({ path: outputPath, fullPage: true });
    }
  }}
