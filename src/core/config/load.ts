import { parse as parseYaml } from 'yaml';

import { ConfigError, parseConfig } from './validate.js';
import { DEFAULT_CONFIG, type Config } from './schema.js';

export const CONFIG_FILENAMES = ['.prproof.yml', '.prproof.yaml'] as const;

/** A configuration file is a few dozen lines. Anything larger is not one. */
export const MAX_CONFIG_BYTES = 64 * 1024;

export interface LoadedConfig {
  readonly config: Config;
  /** Path the configuration came from, or `null` when defaults were used. */
  readonly path: string | null;
  readonly usedDefaults: boolean;
}

/**
 * Parses configuration text.
 *
 * YAML anchors are rejected (`maxAliasCount: 0`). PRProof may read a
 * configuration file written by someone who does not control the repository,
 * and alias expansion is a denial-of-service primitive with no legitimate use
 * in a twenty-key config file.
 */
export function parseConfigText(text: string, path: string): Config {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_CONFIG_BYTES) {
    throw new ConfigError([
      { path, message: `configuration file is ${bytes} bytes, the limit is ${MAX_CONFIG_BYTES}` },
    ]);
  }

  let document: unknown;
  try {
    document = parseYaml(text, { maxAliasCount: 0, prettyErrors: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigError([{ path, message: `could not parse YAML: ${message}` }]);
  }

  if (document === null || document === undefined) {
    return DEFAULT_CONFIG;
  }
  return parseConfig(document);
}

export { DEFAULT_CONFIG };
