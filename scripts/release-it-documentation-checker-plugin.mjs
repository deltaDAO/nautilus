import fs from 'fs'
import { Plugin } from 'release-it'

const docsDir = './docs/'
const versionsFile = `${docsDir}versions.json`
const versionedDocsDir = `${docsDir}versioned_docs/`
const versionedSidebarsDir = `${docsDir}versioned_sidebars/`

export default class DocsPlugin extends Plugin {
  isEarlyPreview = false

  async beforeBump() {
    const { version } = this.config.contextOptions
    const isDryRun = this.config.options['dry-run']
    const withDocsOption = this.config.options['with-docs']

    const shouldPrepareDocs =
      withDocsOption === undefined || withDocsOption !== 'false'

    if (!isDryRun && shouldPrepareDocs)
      await this.prepareDocsForNewVersion(version)
  }

  async prepareDocsForNewVersion(version) {
    this.log.info(`Preparing api documentation for version ${version}`)
    // For releases in active development we only provide one version of docs
    // If we find a `alpha` or `beta` release, strip the versioning for that preview
    const earlyPreview = version.includes('beta')
      ? 'beta'
      : version.includes('alpha')
        ? 'alpha'
        : false
    if (earlyPreview) {
      this.isEarlyPreview = true
      // remove preview specific versioning
      // 1.0.0-beta.12 becomes 1.0.0-beta
      version = version.substring(
        0,
        version.indexOf(earlyPreview) + earlyPreview.length
      )
      this.log.info(
        `Detected early preview version. Checking documentation for version ${version}`
      )

      this.deletePreviewDocsIfExist(version)
      await this.createVersionedDocs(version)
    } else {
      await this.createVersionedDocs(version)
    }
  }

  async createVersionedDocs(version) {
    this.log.info(`Generating API documentation for version ${version}`)
    await this.exec(
      `cd docs && npm run docusaurus generate-typedoc && npm run docusaurus docs:version ${version}`
    )

    try {
      await this.exec(
        `git add . && git commit -m "docs: create typedoc api documentation for version ${version}"`
      )
    } catch (error) {
      this.log.info('No documentation changes found to be committed.')
    }
  }

  deletePreviewDocsIfExist(version) {
    // make sure to overwrite preview versions!
    if (!this.isEarlyPreview) return

    this.log.info(
      `Search for early preview docs to overwrite for version ${version}`
    )

    // remove versioned docs direcotry
    const versionedDocs = `${versionedDocsDir}version-${version}`
    if (fs.existsSync(versionedDocs)) {
      fs.rmSync(versionedDocs, { recursive: true, force: true })
      this.log.info(`Removed docs folder for version ${version}`)
    }

    // remove versioned sidebar file
    const versionedSidebar = `${versionedSidebarsDir}version-${version}-sidebars.json`
    if (fs.existsSync(versionedSidebar)) {
      fs.rmSync(versionedSidebar)
      this.log.info(`Removed sidebar for version ${version}`)
    }

    // remove version from versions file
    const versions = JSON.parse(fs.readFileSync(versionsFile))
    const indexOfVersion = versions.indexOf(version)
    if (indexOfVersion > -1) {
      versions.splice(indexOfVersion, 1)
      fs.writeFileSync(versionsFile, JSON.stringify(versions))
      this.log.info(`Removed version ${version} from version file`)
    }
  }
}
