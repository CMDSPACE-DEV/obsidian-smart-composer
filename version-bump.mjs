import { readFileSync, writeFileSync } from 'fs'

const targetVersion = process.argv[2]
if (!targetVersion) {
  console.error('Please provide a target version as a command line argument.')
  process.exit(1)
}

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(targetVersion)) {
  console.error(`Invalid version: ${targetVersion}`)
  process.exit(1)
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const writeJson = (path, value) =>
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)

const manifest = readJson('manifest.json')
const versions = readJson('versions.json')
const packageJson = readJson('package.json')
const packageLock = readJson('package-lock.json')

const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const documents = [
  ['manifest.json', manifest],
  ['versions.json', versions],
  ['package.json', packageJson],
  ['package-lock.json', packageLock],
]

for (const [path, value] of documents) {
  if (!isRecord(value)) {
    console.error(`${path} must contain a JSON object.`)
    process.exit(1)
  }
}

if (typeof manifest.minAppVersion !== 'string') {
  console.error('manifest.json does not contain a valid minAppVersion.')
  process.exit(1)
}

if (!isRecord(packageLock.packages?.[''])) {
  console.error('package-lock.json does not contain the root package entry.')
  process.exit(1)
}

const { minAppVersion } = manifest
manifest.version = targetVersion
versions[targetVersion] = minAppVersion
packageJson.version = targetVersion
packageLock.version = targetVersion
packageLock.packages[''].version = targetVersion

writeJson('manifest.json', manifest)
writeJson('versions.json', versions)
writeJson('package.json', packageJson)
writeJson('package-lock.json', packageLock)
