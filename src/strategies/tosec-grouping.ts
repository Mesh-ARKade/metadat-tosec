/**
 * TosecGroupingStrategy - Groups TOSEC DATs by manufacturer
 *
 * @intent Group TOSEC DAT files by manufacturer (first part before " - ")
 * @guarantee Creates kebab-case group names ready for JSONL filename
 * @constraint Implements IGroupStrategy interface for pipeline compatibility
 */

import type { DAT, GroupedDATs } from '../types/index.js';
import { IGroupStrategy } from '../contracts/igroup-strategy.js';

/**
 * TosecGroupingStrategy - Groups TOSEC DATs by manufacturer-system
 *
 * @intent Groups DATs by manufacturer (first part of system name before " - ")
 * @guarantee Returns GroupedDATs ready for JSONL creation with proper slugification
 * @constraint Follows same pattern as NoIntroGroupStrategy for consistency
 */
export class TosecGroupingStrategy implements IGroupStrategy {
  /**
   * Group DATs by manufacturer
   * @param dats Array of DAT objects to group
   * @returns GroupedDATs map with manufacturer as key
   */
  group(dats: DAT[]): GroupedDATs {
    const groups: GroupedDATs = {};

    for (const dat of dats) {
      // Extract manufacturer from system name: "Manufacturer - System" → manufacturer
      const groupName = this.extractGroup(dat.system);

      if (!groups[groupName]) {
        groups[groupName] = [];
      }

      groups[groupName].push(dat);
    }

    return groups;
  }

  /**
   * Extract group name from system name
   * @param systemName System name in format "Manufacturer - System"
   * @returns Lowercase manufacturer name suitable for URL/filename
   */
  private extractGroup(systemName: string): string {
    const separatorIndex = systemName.indexOf(' - ');
    if (separatorIndex > 0) {
      const manufacturer = systemName.substring(0, separatorIndex).toLowerCase();
      // Convert to kebab-case for filename safety
      return manufacturer.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }

    // Fallback: use full system name if no separator found
    return systemName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  /**
   * Get the strategy name for this grouping
   * @returns 'tosec' as the strategy identifier
   */
  getStrategyName(): string {
    return 'tosec';
  }
}

/**
 * Parse TOSEC filename to extract components
 * Format: {Manufacturer} {System} - {Category} - [{Format}] (TOSEC-v{VERSION}_CM).dat
 * @param filename TOSEC DAT filename
 * @returns Parsed components with manufacturer, system, category, format, version
 * @example parseTosecFilename("Acorn Archimedes - Games - [ADF] (TOSEC-v2024-05-17_CM).dat")
 * // Returns: { manufacturer: "Acorn Archimedes", system: "Games", category: "ADF", format: "ADF", version: "2024-05-17" }
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
 * Convert manufacturer and system to a kebab-case group name
 * @param manufacturer Manufacturer name
 * @param system System name
 * @returns URL-safe group name
 * @example toGroupName("Acorn Archimedes", "Games") // Returns "acorn-archimedes-games"
 */
export function toGroupName(manufacturer: string, system: string): string {
  const combined = `${manufacturer} ${system}`.toLowerCase();
  return combined
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/&/g, 'and');
}

/**
 * Group DATs by manufacturer-system (alternative entry point)
 * @param dats Array of DAT objects
 * @returns Map of group names to DAT arrays
 */
export function groupDats(dats: DAT[]): { groups: Map<string, DAT[]> } {
  const groups = new Map<string, DAT[]>();

  for (const dat of dats) {
    const parsed = parseTosecFilename(dat.name || '');
    const groupName = toGroupName(parsed.manufacturer, parsed.system);

    if (!groups.has(groupName)) {
      groups.set(groupName, []);
    }

    groups.get(groupName)!.push(dat);
  }

  return { groups };
}

/**
 * Create a unique key for a DAT entry
 * @param dat DAT object
 * @returns Unique identifier string
 */
export function createDatKey(dat: DAT): string {
  return dat.name || 'unknown';
}