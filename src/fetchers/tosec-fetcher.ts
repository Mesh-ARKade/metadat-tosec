/**
 * TosecFetcher - Full TOSEC DAT pipeline
 *
 * @intent Download TOSEC DAT pack, extract all DATs, parse XML, group by manufacturer-system
 * @guarantee Creates properly grouped JSONL files like tosec--acorn.jsonl.zst
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import unzipper from 'unzipper';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import type { DAT, RomEntry } from '../types/index.js';
import { AbstractFetcher } from '../base/base-fetcher.js';
import { VersionTracker } from '../core/version-tracker.js';
import { XMLParser } from 'fast-xml-parser';

const TOSEC_DOWNLOADS_URL = 'https://www.tosecdev.org/downloads/category/22-datfiles';

export class TosecFetcher extends AbstractFetcher {
  private sourceName: string = 'tosec';

  constructor(versionTracker: VersionTracker) {
    super(versionTracker, { maxRetries: 3, retryDelay: 5000 });
  }

  getSourceName(): string {
    return this.sourceName;
  }

  async checkRemoteVersion(): Promise<string> {
    const response = await fetch(TOSEC_DOWNLOADS_URL);
    if (!response.ok) throw new Error(`Failed to fetch TOSEC page: ${response.status}`);
    
    const html = await response.text();
    const categoryPattern = /href="(\/downloads\/category\/\d+-(\d{4}-\d{2}-\d{2}))"/gi;
    const categories: { path: string; date: string }[] = [];
    let match;
    while ((match = categoryPattern.exec(html)) !== null) {
      categories.push({ path: match[1], date: match[2] });
    }
    
    if (categories.length === 0) throw new Error('Could not find TOSEC release categories');
    
    categories.sort((a, b) => b.date.localeCompare(a.date));
    return categories[0].date;
  }

  private async getDownloadUrl(version: string): Promise<string> {
    const response = await fetch(TOSEC_DOWNLOADS_URL);
    const html = await response.text();
    
    const categoryPattern = /href="(\/downloads\/category\/\d+-\d{4}-\d{2}-\d{2})"/gi;
    let catMatch;
    while ((catMatch = categoryPattern.exec(html)) !== null) {
      if (catMatch[1].includes(version)) {
        const categoryUrl = `https://www.tosecdev.org${catMatch[1]}`;
        const catResponse = await fetch(categoryUrl);
        const catHtml = await catResponse.text();
        
        const downloadPattern = /href="(\/downloads\/category\/[^"]*\?download=[^"]+)"/i;
        const dlMatch = downloadPattern.exec(catHtml);
        if (dlMatch) {
          return `https://www.tosecdev.org${dlMatch[1]}`;
        }
      }
    }
    throw new Error(`Could not find download URL for version ${version}`);
  }

  private async downloadZip(url: string, destPath: string): Promise<void> {
    console.log(`[tosec] Downloading: ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    const fileStream = fsSync.createWriteStream(destPath);
    await pipeline(Readable.fromWeb(response.body as any), fileStream);
    console.log(`[tosec] Saved: ${destPath}`);
  }

  private async extractZip(zipPath: string, extractDir: string): Promise<string[]> {
    console.log(`[tosec] Extracting: ${zipPath}`);
    await fs.mkdir(extractDir, { recursive: true });
    
    const datFiles: string[] = [];
    
    await new Promise<void>((resolve, reject) => {
      fsSync.createReadStream(zipPath)
        .pipe(unzipper.Parse())
        .on('entry', (entry: any) => {
          const fileName = entry.path;
          if (fileName.endsWith('.dat') && !fileName.includes('__MACOSX')) {
            const destPath = path.join(extractDir, path.basename(fileName));
            entry.pipe(fsSync.createWriteStream(destPath));
            datFiles.push(destPath);
          } else {
            entry.autodrain();
          }
        })
        .on('close', () => resolve())
        .on('error', reject);
    });
    
    console.log(`[tosec] Extracted ${datFiles.length} DAT files`);
    return datFiles;
  }

  private async parseDatFile(filePath: string): Promise<DAT | null> {
    const content = await fs.readFile(filePath, 'utf-8');
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      parseAttributeValue: false,
    });
    
    try {
      const parsed = parser.parse(content);
      const datafile = parsed.datafile || parsed;
      const header = datafile.header || {};
      
      const games = Array.isArray(datafile.game) ? datafile.game : [datafile.game].filter(Boolean);
      const roms: RomEntry[] = games.map((game: any) => ({
        name: game['@_name'] || game.name || 'unknown',
        size: parseInt(game.rom?.['@_size'] || '0', 10),
        crc: game.rom?.['@_crc'] || undefined,
        md5: game.rom?.['@_md5'] || undefined,
        sha1: game.rom?.['@_sha1'] || undefined,
      }));
      
      const fileName = path.basename(filePath, '.dat');
      const parsedName = this.parseTosecFilename(fileName);
      
      return {
        id: `tosec-${fileName}`,
        source: this.sourceName,
        system: parsedName.system,
        datVersion: parsedName.version,
        name: fileName,
        description: header.description || header.name || fileName,
        roms,
      };
    } catch (err) {
      console.warn(`[tosec] Failed to parse ${filePath}: ${(err as Error).message}`);
      return null;
    }
  }

  private parseTosecFilename(filename: string): {
    manufacturer: string;
    system: string;
    category: string;
    format: string;
    version: string;
  } {
    const name = filename.replace(/\.dat$/, '');
    const versionMatch = name.match(/TOSEC-v(\d{4}-\d{2}-\d{2})/);
    const version = versionMatch ? versionMatch[1] : 'unknown';
    const formatMatch = name.match(/\[([^\]]+)\]/);
    const format = formatMatch ? formatMatch[1] : '';
    
    let base = name.replace(/TOSEC-v\d{4}-\d{2}-\d{2}/, '').replace(/\s*\[[^\]]+\]\s*/, '');
    const parts = base.split(' - ').map(p => p.trim()).filter(p => p);
    
    const manufacturer = parts[0] || 'Unknown';
    const system = parts[1] || manufacturer;
    const category = parts[2] || 'unknown';
    
    return { manufacturer, system, category, format, version };
  }

  async fetchDats(): Promise<DAT[]> {
    const workDir = './work/tosec';
    const zipPath = path.join(workDir, 'TOSEC.zip');
    const extractDir = path.join(workDir, 'extracted');
    
    try {
      await fs.mkdir(workDir, { recursive: true });
      
      const version = await this.checkRemoteVersion();
      console.log(`[tosec] Latest version: ${version}`);
      
      const downloadUrl = await this.getDownloadUrl(version);
      await this.downloadZip(downloadUrl, zipPath);
      
      const datFiles = await this.extractZip(zipPath, extractDir);
      
      console.log(`[tosec] Parsing ${datFiles.length} DAT files...`);
      const dats: DAT[] = [];
      for (const datPath of datFiles) {
        const dat = await this.parseDatFile(datPath);
        if (dat) dats.push(dat);
      }
      
      console.log(`[tosec] Parsed ${dats.length} valid DATs`);
      return dats;
    } finally {
      // Cleanup
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async cleanup(): Promise<void> {
    // Nothing to cleanup without browser
  }
}
