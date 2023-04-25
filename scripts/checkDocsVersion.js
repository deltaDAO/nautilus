const fs = require('fs')

const docsDir = './docs/'
const versionsFile = `${docsDir}versions.json`
const versionedDocsDir = `${docsDir}versioned_docs/`
const versionedSidebarsDir = `${docsDir}versioned_sidebars/`

const colors = {
  black: `\x1b[30m`,
  green: `\x1b[32m`,
  red: `\x1b[31m`
}

const symbols = {
  checkmark: `\u2713`,
  cross: `\u2716`
}

function checkVersion(version) {
  if (!fs.existsSync(versionsFile)) return handleVersionDoesNotExist(version)

  const versions = JSON.parse(fs.readFileSync(versionsFile))
  const versionExists = versions.includes(version)

  const versionedDocsExists = fs.existsSync(
    `${versionedDocsDir}version-${version}`
  )
  const versionedSidebarExists = fs.existsSync(
    `${versionedSidebarsDir}version-${version}-sidebars.json`
  )

  if (!versionExists || !versionedDocsExists || !versionedSidebarExists)
    return handleVersionDoesNotExist(version)

  process.stdout.write(
    `${colors.green}${symbols.checkmark} Documentation ready for release.\n`
  )
}

function handleVersionDoesNotExist(version) {
  // cross-sign & change color to red
  process.stderr.write(
    `${colors.red}${symbols.cross} Documentation not ready for release.`
  )
  // change color to black
  process.stderr.write(
    `${colors.black}\n-- The version (${version}) you are trying to release has no docs ready to use.`
  )
  process.stderr.write(
    '\n-- Make sure to generate the docs first and re-run the release command.'
  )
  process.stderr.write('\n-- Read more: ./docs/README.md\n')

  process.exit(1)
}

const version = process.argv
  .find((arg) => arg.match(/version=\d+\.\d+\.\d+/gm) !== null)
  .replace('version=', '')

checkVersion(version)
