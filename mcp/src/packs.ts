/**
 * Loading domain packs off disk.
 *
 * Packs ship with the plugin under `packs/`, but a pack is often the part an
 * organisation cannot publish — its own process vocabulary. So the loader also
 * reads directories named in `FLOWCHART_PACKS` (path-separator delimited) and
 * `~/.flowchart/packs`, which lets a private pack live outside this repo and
 * survive plugin upgrades.
 *
 * A pack that fails `checkPack` is skipped rather than crashing the server: one
 * malformed private pack must not take the canvas down with it.
 */
import { readdir, readFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { homedir } from 'node:os'
import { checkPack, type Pack } from '../../src/core/pack.js'

export interface LoadedPack extends Pack {
  /** Where it came from, so `pack_list` can show a private pack's origin. */
  source: string
}

export interface PackRegistry {
  packs: Map<string, LoadedPack>
  /** Packs that were found but rejected, with the reason. */
  rejected: string[]
}

function packDirs(pluginRoot: string): string[] {
  const extra = process.env.FLOWCHART_PACKS?.split(delimiter).filter(Boolean) ?? []
  return [join(pluginRoot, 'packs'), join(homedir(), '.flowchart', 'packs'), ...extra]
}

export async function loadPacks(pluginRoot: string): Promise<PackRegistry> {
  const packs = new Map<string, LoadedPack>()
  const rejected: string[] = []

  for (const dir of packDirs(pluginRoot)) {
    let entries: string[]
    try {
      entries = (await readdir(dir, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    } catch {
      continue // A pack directory that doesn't exist is normal, not an error.
    }

    for (const name of entries) {
      const file = join(dir, name, 'pack.json')
      let pack: Pack
      try {
        pack = JSON.parse(await readFile(file, 'utf8')) as Pack
      } catch (err) {
        rejected.push(`${file}: ${err instanceof Error ? err.message : String(err)}`)
        continue
      }
      const problems = checkPack(pack)
      if (problems.length) {
        rejected.push(...problems)
        continue
      }
      // Later directories win, so a private pack can shadow a bundled one.
      packs.set(pack.id, { ...pack, source: file })
    }
  }

  return { packs, rejected }
}
