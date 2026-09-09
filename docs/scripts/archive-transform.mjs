#!/usr/bin/env node
// Transforms a snapshot of docs pages into a legacy archive:
//   - strips twoslash from code fences (vocs 2 typechecks twoslash samples
//     against the installed package, so archived samples must not typecheck)
//   - reproduces twoslash rendering: hides above-`---cut---` setup code and
//     rewrites `@filename:`/`@log:`/`@error:` directives into plain comments
//   - prefixes internal links with the archive prefix
//   - prepends a legacy banner and `searchPriority: 0` frontmatter
//
// Usage: node docs/scripts/archive-transform.mjs <dir> <oldPrefix> <newPrefix> <versionLabel>
//   e.g. node docs/scripts/archive-transform.mjs docs/pages/v1/docs /docs /v1/docs v1.1.0

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [dir, oldPrefix, newPrefix, versionLabel] = process.argv.slice(2)
if (!dir || !oldPrefix || !newPrefix || !versionLabel) {
  console.error(
    'Usage: archive-transform.mjs <dir> <oldPrefix> <newPrefix> <versionLabel>'
  )
  process.exit(1)
}

function banner() {
  return [
    '---',
    'searchPriority: 0',
    '---',
    '',
    ':::warning',
    `You are viewing the documentation for Nautilus **${versionLabel}** (legacy). Switch to the [latest documentation](${oldPrefix}/introduction), or follow the [migration guide](${oldPrefix}/migration) to upgrade.`,
    ':::',
    '',
    ''
  ].join('\n')
}

function transformFence(lines) {
  // Twoslash hides everything above the last `---cut---`; do the same.
  const lastCut = lines.findLastIndex((l) => /^\s*\/\/ ---cut---\s*$/.test(l))
  const kept = lastCut === -1 ? lines : lines.slice(lastCut + 1)
  return kept
    .map((l) =>
      l
        .replace(/^(\s*)\/\/ @filename: (.*)$/, '$1// $2')
        .replace(/^(\s*)\/\/ @log: (.*)$/, '$1// => $2')
        .replace(/^(\s*)\/\/ @error: (.*)$/, '$1// Error: $2')
    )
    .filter((l) => !/^\s*\/\/ @[a-zA-Z-]+(: .*)?\s*$/.test(l))
}

function transformFile(path) {
  const src = readFileSync(path, 'utf8')
  const out = []
  let fence = null // collected lines of a formerly-twoslash fence
  for (const line of src.split('\n')) {
    if (fence) {
      if (/^```\s*$/.test(line)) {
        out.push(...transformFence(fence), line)
        fence = null
      } else {
        fence.push(line)
      }
      continue
    }
    const open = line.match(/^``` ?(\S+) twoslash(.*)$/)
    if (open) {
      out.push(`\`\`\`${open[1]}${open[2]}`)
      fence = []
      continue
    }
    out.push(
      line
        .replaceAll(`](${oldPrefix}/`, `](${newPrefix}/`)
        .replaceAll(`href="${oldPrefix}/`, `href="${newPrefix}/`)
        // vocs 1 exported components from 'vocs/components'; vocs 2 exports them from the root.
        .replace(/^(import .*) from 'vocs\/components'$/, "$1 from 'vocs'")
    )
  }
  if (fence) throw new Error(`Unclosed code fence in ${path}`)
  writeFileSync(path, banner() + out.join('\n'))
}

function walk(d) {
  for (const entry of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, entry.name)
    if (entry.isDirectory()) walk(p)
    else if (entry.name.endsWith('.mdx')) {
      transformFile(p)
      console.log(`transformed ${p}`)
    }
  }
}

walk(dir)
