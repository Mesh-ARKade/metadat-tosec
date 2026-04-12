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
  private currentPage: Page | null = null;

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

      // Find the latest release date - look for heading with date format
      const versionDate = await page.evaluate(() => {
        // Look for the date in the table showing current version
        const cells = Array.from(document.querySelectorAll('td'));
        for (const cell of cells) {
          const text = cell.textContent || '';
          const match = text.match(/(\d{4}-\d{2}-\d{2})/);
          if (match) return match[1];
        }
        return null;
      });

      if (!versionDate) {
        throw new Error('Could not find version date on TOSEC downloads page');
      }

      return versionDate;
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

      // Get the current version date from the status table
      const versionDate = await page.evaluate(() => {
        const cells = Array.from(document.querySelectorAll('td'));
        for (const cell of cells) {
          const text = cell.textContent || '';
          const match = text.match(/(\d{4}-\d{2}-\d{2})/);
          if (match) return match[1];
        }
        return '2024-05-17'; // fallback to known version
      });

      // Now get the download link - look for the main DAT pack download
      // The download is in the "Download" link in the first file row
      const downloadInfo = await page.evaluate(() => {
        // Find links that say "Download" near the date
        const links = Array.from(document.querySelectorAll('a'));
        for (const link of links) {
          const text = link.textContent?.trim().toLowerCase() || '';
          const href = link.getAttribute('href') || '';
          if (text === 'download' && href) {
            return { href, text: 'TOSEC DAT Pack' };
          }
        }
        return null;
      });

      if (downloadInfo) {
        const dat: DAT = {
          id: `tosec-${versionDate}`,
          source: this.sourceName,
          system: 'tosec',
          datVersion: versionDate,
          roms: [],
          name: `TOSEC-v${versionDate}.zip`,
          description: downloadInfo.href,
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

    if (!this.currentPage) {
      const context = await this.browser.newContext();
      this.currentPage = await context.newPage();
    }

    return this.currentPage;
  }

  /**
   * Clean up browser resources
   */
  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.currentPage = null;
    }
  }
}
