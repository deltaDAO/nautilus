const fs = require('fs')

const docsDir = './docs/'
const versionsFile = 'versions.json'
const versionedDocsDir = `${docsDir}versioned_docs/`
const versionedSidebarsDir = `${docsDir}versioned_sidebars/`

function checkVersion(version) {
  if (!fs.existsSync(versionsFile)) return handleVersionDoesNotExist(version)

  const versions = JSON.parse(fs.readFileSync(versionsFile))
  const versionExists = versions.includes(version)

  const versionedDocsExists = fs.existsSync(
    `${versionedDocsDir}version-${version}`
  )
  const versionedSidebarExists = fs.existsSync(
    `${versionedSidebarsDir}version-${version}-sidebar.json`
  )

  if (!versionExists || !versionedDocsExists || !versionedSidebarExists)
    return handleVersionDoesNotExist(version)

  console.log('Docs are ready for release!')
}

function handleVersionDoesNotExist(version) {
  process.stderr.write(
    `\u274C Documentation not ready for release\n-- The version (${version}) you are trying to release has no docs ready to use.\n-- Make sure to generate the docs first and re-run the release command.\n-- Read more: ./docs/README.md\n`,
    () => process.exit(1)
  )
}

const version = process.argv
  .find((arg) => arg.match(/version=\d+\.\d+\.\d+/gm) !== null)
  .replace('version=', '')

checkVersion(version)
