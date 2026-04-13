/**
 * TosecFetcher - Fetches DATs from tosecdev.org
 *
 * @intent Download TOSEC DAT pack, extract, and parse into DAT objects
 * @guarantee Returns properly typed DAT[] ready for grouping and JSONL creation
 * @constraint Extends AbstractFetcher, uses direct HTTP for downloads with unzipper for extraction
 */

import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import unzipper from 'unzipper';
import { AbstractFetcher, type FetcherOptions } from '../base/base-fetcher.js';
import { VersionTracker } from '../core/version-tracker.js';
import type { DAT, RomEntry } from '../types/index.js';
import { extractGameEntries } from '../core/validator.js';

/**
 * TOSEC downloads page URL
 */
const TOSEC_DOWNLOADS_URL = 'https://www.tosecdev.org/downloads/category/22-datfiles';

/**
 * TosecFetcher - Fetches TOSEC DAT packs from tosecdev.org
 *
 * @intent Downloads the complete TOSEC DAT pack, extracts all DAT files, and parses them
 * @guarantee Returns DAT[] with manufacturer-system grouping metadata for downstream processing
 * @constraint Uses direct HTTP fetch with unzipper extraction, compatible with No-Intro format
 */
export class TosecFetcher extends AbstractFetcher {
  private outputDir: string;

  constructor(
    versionTracker: VersionTracker,
    outputDir: string = './output/tosec',
    options: FetcherOptions = {}
  ) {
    super(versionTracker, {
      maxRetries: options.maxRetries ?? 3,
      retryDelay: options.retryDelay ?? 5000,
      rateLimitMs: options.rateLimitMs ?? 2000
    });
    this.outputDir = outputDir;
  }

  /**
   * Get the source name for this fetcher
   * @returns 'tosec' as the source identifier
   */
  getSourceName(): string {
    return 'tosec';
  }

  /**
   * Check the remote version by scraping tosecdev.org for latest release date
   * @returns Version string in YYYY-MM-DD format
   */
  async checkRemoteVersion(): Promise<string> {
    try {
      const response = await fetch(TOSEC_DOWNLOADS_URL);
      if (!response.ok) {
        throw new Error(`Failed to fetch TOSEC page: ${response.status}`);
      }

      const html = await response.text();

      // Parse the page to find the latest release category
      // Pattern: /downloads/category/{id}-{YYYY-MM-DD}
      const categoryPattern = /href="(\/downloads\/category\/\d+-(\d{4}-\d{2}-\d{2}))"/gi;
      const categories: { path: string; date: string }[] = [];

      let match;
      while ((match = categoryPattern.exec(html)) !== null) {
        categories.push({ path: match[1], date: match[2] });
      }

      if (categories.length === 0) {
        throw new Error('Could not find TOSEC release categories');
      }

      // Sort by date descending and return the latest
      categories.sort((a, b) => b.date.localeCompare(a.date));
      return categories[0].date;
    } catch (err) {
      console.error('[tosec] Failed to check remote version:', (err as Error).message);
      throw err;
    }
  }

  /**
   * Get the download URL for a specific version
   * @param version Version date in YYYY-MM-DD format
   * @returns Full download URL
   */
  private async getDownloadUrl(version: string): Promise<string> {
    const response = await fetch(TOSEC_DOWNLOADS_URL);
    const html = await response.text();

    const categoryPattern = /href="(\/downloads\/category\/\d+-\d{4}-\d{2}-\d{2})"/gi;
    let catMatch;

    while ((catMatch = categoryPattern.exec(html)) !== null) {
      if (catMatch[1].includes(version)) {
        const categoryUrl = `https://www.tosecdev.org${catMatch[1]}`;
        const catResponse = await fetch(categoryUrl);

        if (!catResponse.ok) {
          continue;
        }

        const catHtml = await catResponse.text();

        // Find the download link pattern: ?download={id}:{filename}
        const downloadPattern = /href="(\/downloads\/category\/[^"]*\?download=[^"]+)"/i;
        const dlMatch = downloadPattern.exec(catHtml);

        if (dlMatch) {
          return `https://www.tosecdev.org${dlMatch[1]}`;
        }
      }
    }

    throw new Error(`Could not find download URL for version ${version}`);
  }

  /**
   * Download a file from URL to disk
   * @param url Source URL
   * @param destPath Destination file path
   */
  private async downloadFile(url: string, destPath: string): Promise<void> {
    console.log(`[tosec] Downloading: ${url}`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    await fs.mkdir(path.dirname(destPath), { recursive: true });

    const fileStream = fsSync.createWriteStream(destPath);
    await pipeline(Readable.fromWeb(response.body as any), fileStream);

    console.log(`[tosec] Saved: ${destPath}`);
  }

  /**
   * Extract a ZIP file
   * @param zipPath Path to ZIP file
   * @param extractDir Directory to extract to
   * @returns Array of extracted file paths
   */
  private async extractZip(zipPath: string, extractDir: string): Promise<string[]> {
    console.log(`[tosec] Extracting: ${zipPath}`);

    await fs.mkdir(extractDir, { recursive: true });

    const datFiles: string[] = [];

    await new Promise<void>((resolve, reject) => {
      fsSync.createReadStream(zipPath)
        .pipe(unzipper.Parse())
        .on('entry', (entry: unzipper.Entry) => {
          const fileName = entry.path;

          // Only extract .dat files, skip __MACOSX directories
          if (fileName.endsWith('.dat') && !fileName.includes('__MACOSX')) {
            const destPath = path.join(extractDir, path.basename(fileName));
            entry.pipe(fsSync.createWriteStream(destPath));
            datFiles.push(destPath);
          } else {
            entry.autodrain();
          }
        })
        .on('close', () => resolve())
        .on('error', (err) => reject(err));
    });

    console.log(`[tosec] Extracted ${datFiles.length} DAT files`);
    return datFiles;
  }

  /**
   * Parse a single DAT file and extract game entries
   * @param filePath Path to DAT file
   * @returns Parsed DAT object or null on failure
   */
  private async parseDatFile(filePath: string, version: string): Promise<DAT | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const result = extractGameEntries(content);

      if (!result.valid || result.games.length === 0) {
        console.warn(`[tosec] No games found in: ${path.basename(filePath)}`);
        return null;
      }

      const fileName = path.basename(filePath, '.dat');
      const parsedFilename = parseTosecFilename(fileName);

      // Extract ROMs from each game
      const roms: RomEntry[] = [];
      for (const game of result.games) {
        const gameRoms = extractRomsFromGame(game);
        roms.push(...gameRoms);
      }

      return {
        id: `tosec-${fileName}`,
        source: 'tosec',
        system: parsedFilename.system || fileName,
        datVersion: version,
        name: fileName,
        description: parsedFilename.category || fileName,
        roms,
        category: parsedFilename.category,
        format: parsedFilename.format,
      };
    } catch (err) {
      console.warn(`[tosec] Failed to parse ${filePath}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Fetch DATs from TOSEC
   * @returns Array of parsed DAT objects ready for grouping
   */
  async fetchDats(): Promise<DAT[]> {
    await fs.mkdir(this.outputDir, { recursive: true });

    const workDir = path.join(this.outputDir, 'work');
    const zipPath = path.join(workDir, 'TOSEC.zip');
    const extractDir = path.join(workDir, 'extracted');

    try {
      // Step 1: Check remote version
      console.log('[tosec] Checking for latest version...');
      const version = await this.checkRemoteVersion();
      console.log(`[tosec] Latest version: ${version}`);

      // Step 2: Check if we should skip (version already downloaded)
      const shouldSkip = await this.shouldSkip();
      if (shouldSkip) {
        console.log('[tosec] Already on latest version, skipping download');
        return [];
      }

      // Step 3: Get download URL
      const downloadUrl = await this.getDownloadUrl(version);

      // Step 4: Download the ZIP
      await fs.mkdir(workDir, { recursive: true });
      await this.downloadFile(downloadUrl, zipPath);

      // Step 5: Extract the ZIP
      const datFiles = await this.extractZip(zipPath, extractDir);
      console.log(`[tosec] Processing ${datFiles.length} DAT files...`);

      // Step 6: Parse each DAT file
      const dats: DAT[] = [];
      for (const datPath of datFiles) {
        const dat = await this.parseDatFile(datPath, version);
        // ALWAYS include the DAT - even if it has 0 roms
        // FIREHOSE: capture everything, group later
        if (dat) {
          dats.push(dat);
        } else {
          // Even if parsing failed, create a basic entry so we don't lose the file
          const fileName = path.basename(datPath, '.dat');
          dats.push({
            id: `tosec-${fileName}`,
            source: 'tosec',
            system: fileName.split(' - ')[0] || 'unknown',
            datVersion: version,
            name: fileName,
            description: 'Parsing failed - needs investigation',
            roms: [],
          });
        }
      }

      console.log(`[tosec] Parsed ${dats.length} DAT entries (including empty ones)`);

      // Step 7: Update version tracking
      await this.updateVersion(version);

      return dats;
    } catch (err) {
      console.error('[tosec] Fetch error:', (err as Error).message);
      throw err;
    } finally {
      // Cleanup work directory
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/**
 * Parse TOSEC filename to extract components
 * Format: {Manufacturer} {System} - {Category} - [{Format}] (TOSEC-v{VERSION}_CM).dat
 * @param filename TOSEC DAT filename
 * @returns Parsed components
 */
export function parseTosecFilename(filename: string): {
  manufacturer: string;
  system: string;
  category: string;
  format: string;
  version: string;
} {
  // Remove .dat extension
  const name = filename.replace(/\.dat$/i, '');

  // Extract version: TOSEC-v{YYYY-MM-DD}
  const versionMatch = name.match(/TOSEC-v(\d{4}-\d{2}-\d{2})/);
  const version = versionMatch ? versionMatch[1] : 'unknown';

  // Extract format: [format] e.g., [ADF], [DSK], [ISO]
  const formatMatch = name.match(/\[([^\]]+)\]/);
  const format = formatMatch ? formatMatch[1] : '';

  // Remove version and format to parse manufacturer/system/category
  let base = name
    .replace(/TOSEC-v\d{4}-\d{2}-\d{2}[^)]*\)?/g, '')
    .replace(/\s*\[[^\]]+\]\s*/g, '')
    .trim();

  // Split by " - " to get manufacturer, system, category
  const parts = base.split(' - ').map(p => p.trim()).filter(p => p);

  const manufacturer = parts[0] || 'Unknown';
  const system = parts[1] || manufacturer;
  const category = parts[2] || 'Unknown';

  return { manufacturer, system, category, format, version };
}

/**
 * Extract ROM entries from a game entry (TOSEC format)
 * @param game Game object from XML parser
 * @returns Array of ROM entries
 */
function extractRomsFromGame(game: Record<string, unknown>): RomEntry[] {
  const roms: RomEntry[] = [];

  const romElement = game.rom;
  if (!romElement) return roms;

  // Handle single ROM or array of ROMs
  const romArray = Array.isArray(romElement) ? romElement : [romElement];

  for (const rom of romArray) {
    if (!rom || typeof rom !== 'object') continue;

    const romObj = rom as Record<string, unknown>;

    const entry: RomEntry = {
      name: String(romObj.name || romObj['@_name'] || ''),
      size: Number(romObj.size) || 0,
    };

    // Add checksums if present
    if (romObj.crc) entry.crc = String(romObj.crc);
    if (romObj.md5) entry.md5 = String(romObj.md5);
    if (romObj.sha1) entry.sha1 = String(romObj.sha1);
    if (romObj.sha256) entry.sha256 = String(romObj.sha256);

    if (entry.name) {
      roms.push(entry);
    }
  }

  return roms;
}

// CLI entry point
const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isDirectRun) {
  const outputDir = process.argv[2] || './output/tosec';
  const tracker = new VersionTracker('./versions.json');
  const fetcher = new TosecFetcher(tracker, outputDir);

  fetcher.fetchDats()
    .then(dats => console.log(`[tosec] Fetch complete: ${dats.length} DATs`))
    .catch((err: Error) => {
      console.error(`[tosec] Error: ${err.message}`);
      process.exit(1);
    });
}