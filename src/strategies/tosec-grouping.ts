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
   * Group DATs by manufacturer ONLY
   * @param dats Array of DAT objects to group
   * @returns GroupedDATs map with manufacturer as key
   * @description FIREHOSE: Aggressive grouping - manufacturer only, not manufacturer+system
   */
  group(dats: DAT[]): GroupedDATs {
    const groups: GroupedDATs = {};

    for (const dat of dats) {
      // FIREHOSE: Group by manufacturer ONLY to avoid asset limit
      // "Acorn Archimedes - Games" + "Acorn BBC Micro - Games" = "acorn"
      const groupName = this.extractManufacturer(dat.system, dat.name);

      if (!groups[groupName]) {
        groups[groupName] = [];
      }

      groups[groupName].push(dat);
    }

    return groups;
  }

  /**
   * Extract group key from a DAT — first LETTER of the manufacturer.
   *
   * @intent Keep artifact count well under GitHub's 1,000-asset cap. TOSEC has
   *         ~220+ unique manufacturer names, so grouping by first word produces
   *         ~220 artifacts per run. Grouping by first letter caps it at 26.
   * @param system System name from DAT
   * @param name Full filename (preferred — more reliable for TOSEC)
   * @returns Single lowercase letter (a–z) or 'misc' for non-alpha/unknown
   */
  private extractManufacturer(system: string, name?: string): string {
    let manufacturer = '';

    // Prefer filename — it carries the full TOSEC naming convention
    if (name) {
      manufacturer = parseTosecFilename(name).manufacturer;
    }

    if (!manufacturer || manufacturer === 'Unknown') {
      manufacturer = parseTosecFilename(system).manufacturer;
    }

    if (manufacturer && manufacturer !== 'Unknown') {
      const firstChar = manufacturer[0].toLowerCase();
      // Only a-z letters become group keys; numbers/symbols go to misc
      if (/^[a-z]$/.test(firstChar)) return firstChar;
    }

    return 'misc';
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

  // Remove the full TOSEC version parenthetical (including the opening paren)
  // e.g. " (TOSEC-v2024-05-17_CM)" → ""
  let base = name
    .replace(/\s*\(TOSEC-v\d{4}-\d{2}-\d{2}[^)]*\)/g, '')
    .replace(/\s*\[[^\]]+\]\s*/g, '')
    .replace(/\s*-\s*$/g, '') // strip trailing " -" left after bracket removal
    .trim();

  // Split by " - " to get manufacturer, system, category
  const parts = base.split(' - ').map(p => p.trim()).filter(p => p);

  const manufacturer = parts[0] || 'Unknown';
  const system = parts[1] || manufacturer;
  // Fall back to format (e.g. 'ADF') when no explicit category part exists
  const category = parts[2] || format || 'Unknown';

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