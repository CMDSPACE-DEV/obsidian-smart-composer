// Verifies that every file carrying the plugin version agrees.
//
// Without an argument it only checks internal consistency, so CI catches a
// half-done version bump at PR time instead of at release time.
// With a version argument (the release tag) it additionally requires every
// file to match that version.
import { readFileSync } from 'node:fs'

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

const expected = process.argv[2]
const packageJson = readJson('package.json')
const packageLock = readJson('package-lock.json')
const manifest = readJson('manifest.json')
const versions = readJson('versions.json')

const sources = [
  ['package.json', packageJson.version],
  ['package-lock.json', packageLock.version],
  ['package-lock.json root package', packageLock.packages?.['']?.version],
  ['manifest.json', manifest.version],
]

const target = expected ?? packageJson.version
const label = expected ? `tag ${expected}` : `package.json (${target})`
const mismatches = sources.filter(([, version]) => version !== target)
for (const [source, version] of mismatches) {
  console.error(
    `${source} has ${String(version)}; expected ${target} from ${label}.`,
  )
}

if (versions[target] !== manifest.minAppVersion) {
  console.error(
    `versions.json has ${String(versions[target])}; expected ${manifest.minAppVersion} for ${target}.`,
  )
  process.exit(1)
}

if (mismatches.length > 0) process.exit(1)

const lockName = packageLock.packages?.['']?.name
if (lockName !== packageJson.name) {
  console.error(
    `package-lock.json root package is named ${String(lockName)}; expected ${packageJson.name}.`,
  )
  process.exit(1)
}

console.log(`Version parity OK at ${target}.`)
