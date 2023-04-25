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
  process.stderr(
    `\u274C The version (${version}) you are trying to release has not docs ready to use. Make sure to generate the docs first and re-run the release command.`
  )
  throw new Error(``)
}

const version = process.argv
  .find((arg) => arg.match(/version=\d+\.\d+\.\d+/gm) !== null)
  .replace('version=', '')

checkVersion(version)
