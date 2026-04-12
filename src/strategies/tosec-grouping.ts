/**
 * TosecGroupingStrategy - Group TOSEC DATs by manufacturer-system
 *
 * @intent Group TOSEC DAT files by manufacturer and system hierarchy
 * @guarantee All DATs for a given manufacturer-system are grouped together
 */

import type { DAT } from '../types/index.js';

export interface GroupResult {
  groups: Map<string, DAT[]>;
}

/**
 * Parse TOSEC filename to extract components
 * Format: {Manufacturer} {System} - {Category} - [{Format}] (TOSEC-v{VERSION}_CM).dat
 */
export function parseTosecFilename(filename: string): {
  manufacturer: string;
  system: string;
  category: string;
  format: string;
  version: string;
} {
  // Remove .dat extension and any path
  const name = filename.replace(/\.dat$/, '').replace(/^.*\//, '');

  // Extract version
  const versionMatch = name.match(/TOSEC-v(\d{4}-\d{2}-\d{2})/);
  const version = versionMatch ? versionMatch[1] : 'unknown';

  // Extract format in brackets: [BIN], [K7], [DSK], etc.
  const formatMatch = name.match(/\[([^\]]+)\]/);
  const format = formatMatch ? formatMatch[1] : '';

  // Remove version and format from name for parsing manufacturer/system
  let base = name
    .replace(/TOSEC-v\d{4}-\d{2}-\d{2}/, '')
    .replace(/\s*\[[^\]]+\]\s*/, '');

  // Split by " - " to get manufacturer, system, category
  const parts = base.split(' - ').map((p) => p.trim());

  const manufacturer = parts[0] || 'Unknown';
  const system = parts[1] || manufacturer; // If no system, use manufacturer
  const category = parts[2] || 'unknown';

  return { manufacturer, system, category, format, version };
}

/**
 * Generate a kebab-case group name from manufacturer and system
 */
export function toGroupName(manufacturer: string, system: string): string {
  const combined = `${manufacturer} ${system}`.toLowerCase();
  
  // Replace special characters and spaces with hyphens
  return combined
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/&/g, 'and');
}

/**
 * Group DATs by manufacturer-system
 */
export function groupDats(dats: DAT[]): GroupResult {
  const groups = new Map<string, DAT[]>();

  for (const dat of dats) {
    const parsed = parseTosecFilename(dat.name || '');
    const groupName = toGroupName(parsed.manufacturer, parsed.system);

    if (!groups.has(groupName)) {
      groups.set(groupName, []);
    }

    const group = groups.get(groupName)!;
    group.push({
      ...dat,
      system: parsed.system,
      category: parsed.category || 'unknown',
      format: parsed.format || 'unknown',
    });
  }

  return { groups };
}

/**
 * Create a unique key for a DAT entry
 */
export function createDatKey(dat: DAT): string {
  return dat.name || 'unknown';
}