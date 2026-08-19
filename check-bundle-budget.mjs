import fs from 'fs'

const maxMainBytes = Math.floor(6.5 * 1024 * 1024)
const mainBytes = fs.statSync('main.js').size

if (mainBytes > maxMainBytes) {
  throw new Error(
    `main.js is ${mainBytes.toLocaleString()} bytes; the 2.6.0 budget is ${maxMainBytes.toLocaleString()} bytes.`,
  )
}

const metafile = JSON.parse(fs.readFileSync('meta.json', 'utf8'))
const bundleInputs = Object.keys(metafile.inputs)
const tokenizerInputs = bundleInputs.filter((path) =>
  path.includes('node_modules/js-tiktoken/'),
)
const forbiddenTokenizerInputs = tokenizerInputs.filter(
  (path) =>
    path.endsWith('/dist/index.js') ||
    (path.includes('/dist/ranks/') && !path.endsWith('/cl100k_base.js')),
)

if (forbiddenTokenizerInputs.length > 0) {
  throw new Error(
    `Unexpected tokenizer data entered the production bundle:\n${forbiddenTokenizerInputs.join(
      '\n',
    )}`,
  )
}

const nodeFetchBrowserInput = bundleInputs.find((path) =>
  path.endsWith('node_modules/node-fetch/browser.js'),
)
const nodeFetchDesktopInput = bundleInputs.find((path) =>
  path.endsWith('node_modules/node-fetch/lib/index.js'),
)

if (nodeFetchBrowserInput || !nodeFetchDesktopInput) {
  throw new Error(
    'The desktop MCP transport must bundle node-fetch/lib/index.js without node-fetch/browser.js.',
  )
}

console.log(
  `Bundle budget passed: ${mainBytes.toLocaleString()} / ${maxMainBytes.toLocaleString()} bytes.`,
)
