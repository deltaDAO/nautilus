const fs = require('fs')
const readline = require('readline')

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

const readlineInterface = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

function checkVersion(version) {
  // For releases in active development we only provide one version of docs
  // If we find a `alpha` or `beta` release, strip the versioning for that preview
  const earlyPreview = version.includes('beta')
    ? 'beta'
    : version.includes('alpha')
    ? 'alpha'
    : false
  if (earlyPreview) {
    // remove preview specific versioning
    // 1.0.0-beta.12 becomes 1.0.0-beta
    version = version.substring(
      0,
      version.indexOf(earlyPreview) + earlyPreview.length
    )

    // Ask user to confirm if they made sure docs are updated
    // for the early preview version to be released,
    // since we dont check for multiple versions of the same preview
    // e.g. 1.0.0-beta.1 uses same version tag as 1.0.0-beta.2 (1.0.0-beta)
    readlineInterface.question(
      `Early Preview Detected: ${version}\nDid you update the Docusaurus documentation? (y/n): `,
      (input) => {
        if (input !== 'y') {
          process.stdout.write(`User did not confirm updated documentation.\n`)
          handleVersionDoesNotExist(version)
        }

        process.stdout.write(
          `Checking early preview documentation for ${version}\n`
        )

        verifyVersionDocsExist(version)
      }
    )
  } else {
    verifyVersionDocsExist(version)
  }
}

function verifyVersionDocsExist(version) {
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
