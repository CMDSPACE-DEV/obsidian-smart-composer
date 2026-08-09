import { createHash } from 'node:crypto'
import { createReadStream, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const [, , artifactId, artifactPath, requestedUrl] = process.argv

if (!artifactId || !artifactPath || !requestedUrl) {
  console.error(
    'Usage: node verify-pinned-artifact.mjs <artifact-id> <path> <url>',
  )
  process.exit(2)
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const allowlistPath = resolve(
  scriptDirectory,
  '..',
  'runtime-smoke-allowlist.json',
)
const allowlist = JSON.parse(readFileSync(allowlistPath, 'utf8'))
const artifact = allowlist.artifacts?.[artifactId]

if (!artifact) {
  console.error(`Artifact ${artifactId} is not in ${allowlistPath}.`)
  process.exit(1)
}

if (artifact.url !== requestedUrl) {
  console.error(
    `URL mismatch for ${artifactId}: requested ${requestedUrl}; allowlisted ${artifact.url}.`,
  )
  process.exit(1)
}

const fileSize = statSync(artifactPath).size
if (fileSize !== artifact.bytes) {
  console.error(
    `Byte-length mismatch for ${artifactId}: downloaded ${fileSize}; allowlisted ${artifact.bytes}.`,
  )
  process.exit(1)
}

const digest = createHash('sha256')
for await (const chunk of createReadStream(artifactPath)) digest.update(chunk)
const sha256 = digest.digest('hex')

if (sha256 !== artifact.sha256) {
  console.error(
    `SHA-256 mismatch for ${artifactId}: downloaded ${sha256}; allowlisted ${artifact.sha256}.`,
  )
  process.exit(1)
}

console.log(
  `${artifactId}: verified ${fileSize} bytes, sha256:${sha256} (reviewed ${allowlist.reviewedAt}).`,
)
