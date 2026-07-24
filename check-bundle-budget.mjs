import fs from 'fs'

const maxMainBytes = Math.floor(5.2 * 1024 * 1024)
const mainBytes = fs.statSync('main.js').size

if (mainBytes > maxMainBytes) {
  throw new Error(
    `main.js is ${mainBytes.toLocaleString()} bytes; the 2.1.0 budget is ${maxMainBytes.toLocaleString()} bytes.`,
  )
}

const metafile = JSON.parse(fs.readFileSync('meta.json', 'utf8'))
const tokenizerInputs = Object.keys(metafile.inputs).filter((path) =>
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

console.log(
  `Bundle budget passed: ${mainBytes.toLocaleString()} / ${maxMainBytes.toLocaleString()} bytes.`,
)
