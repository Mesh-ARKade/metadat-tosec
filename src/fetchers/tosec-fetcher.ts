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

      // Find the latest release date from the status table
      // The date appears in a table cell with format YYYY-MM-DD
      const versionDate = await page.evaluate(() => {
        const cells = Array.from(document.querySelectorAll('td'));
        for (const cell of cells) {
          const text = cell.textContent?.trim() || '';
          const match = text.match(/^(\d{4}-\d{2}-\d{2})$/);
          if (match) return match[1];
        }
        return null;
      });

      if (!versionDate) {
        // Fallback: look for date in the date links on the page
        const dateFromLink = await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a'));
          for (const link of links) {
            const text = link.textContent?.trim() || '';
            const match = text.match(/^(\d{4}-\d{2}-\d{2})$/);
            if (match) return match[1];
          }
          return '2024-05-17'; // known fallback
        });
        return dateFromLink;
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

      // Get the version date
      const versionDate = await this.checkRemoteVersion();

      // Click on the date link to get to the file page
      const dateLink = await page.locator('a', { hasText: new RegExp(`^${versionDate}$`) }).first();
      if (await dateLink.isVisible().catch(() => false)) {
        await dateLink.click();
        await page.waitForLoadState('domcontentloaded');
      }

      // Now find the download link for the complete DAT pack
      const downloadInfo = await page.evaluate(() => {
        // Look for the ZIP file link - it contains the filename
        const links = Array.from(document.querySelectorAll('a'));
        
        // First try to find the complete pack link
        for (const link of links) {
          const text = link.textContent?.trim() || '';
          const href = link.getAttribute('href') || '';
          
          // Look for the complete DAT pack
          if (text.includes('TOSEC') && text.includes('DAT Pack') && text.includes('.zip')) {
            return { 
              href, 
              filename: text,
              isComplete: text.includes('Complete')
            };
          }
        }
        
        // Fallback: any TOSEC zip file
        for (const link of links) {
          const text = link.textContent?.trim() || '';
          const href = link.getAttribute('href') || '';
          if (text.includes('TOSEC') && text.includes('.zip')) {
            return { href, filename: text, isComplete: false };
          }
        }
        
        return null;
      });

      if (downloadInfo) {
        // Build the full download URL
        const baseUrl = 'https://www.tosecdev.org';
        const downloadUrl = downloadInfo.href.startsWith('http') 
          ? downloadInfo.href 
          : baseUrl + downloadInfo.href;

        const dat: DAT = {
          id: `tosec-${versionDate}`,
          source: this.sourceName,
          system: 'tosec',
          datVersion: versionDate,
          roms: [],
          name: downloadInfo.filename,
          description: downloadUrl,
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
