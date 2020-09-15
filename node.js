#!/usr/bin/env node

'use strict'

const meow = require('meow')
const fs = require('fs')
const fsPromises = fs.promises
const { dim, red, cyan, underline, green } = require('kleur')
const path = require('path')
const { inc } = require('semver')
const { promisify } = require('util')
const recommendedBump = promisify(require(`conventional-recommended-bump`))
const { Listr } = require('listr2')
const { textSync: figlet } = require('figlet')
const indentString = require('indent-string')
const execa = require('execa')
const { ProjectsBundle } = require('@gitbeaker/node')

require('dotenv').config()

const {
  version: currentVersion,
  projectRoot,
  generateChangelog,
  getLatestChangelog,
} = require('./utils')

/**
 * This is a tool to simplify some git tasks. See it as an extension like git-flow.
 *
 * @description
 * Use `melody --help` to get a detailed help and usage information.
 *
 * @package {@link https://github.com/muuvmuuv/melody}
 */
const cli = meow(
  `
  ${underline('Usage')}
    ${dim('$')} melody <task> [...options]

  ${underline('Tasks')}
    - release

  ${underline('Options')}
    --finish, -f        Finish a task
    --publish, -p       Publish a task
    --project, -i       GitLab repository project id
    --allow-dirty       Force run task
    --dry-run           Just tell what will happen
    --delete            Deletes a branch or tag (default: true)

  ${underline('Examples')}
    ${dim('$')} melody release --publish
`,
  {
    description: cyan(
      indentString(
        figlet('Melody', {
          font: 'Bigfig',
        }),
        2
      ).trim()
    ),
    version: currentVersion,
    inferType: true,
    flags: {
      verbose: {
        type: 'boolean',
      },
      dryRun: {
        type: 'boolean',
      },
      allowDirty: {
        type: 'boolean',
      },
      finish: {
        type: 'boolean',
        alias: 'f',
      },
      publish: {
        type: 'boolean',
        alias: 'p',
      },
      delete: {
        type: 'boolean',
        default: true,
      },
      project: {
        type: 'string',
      },
    },
  }
)

const allowedTasks = ['release']
const {
  input: { 0: task },
  flags: { dryRun, verbose, allowDirty, delete: deletes, project, ...flags },
} = cli
const renderer = verbose ? 'verbose' : 'default'

if (!task) {
  cli.showHelp(0)
}

if (!allowedTasks.includes(task)) {
  console.log(`
  ${red(`Task '${task}' is not a valid task`)}

  Possible values are: ${allowedTasks.join(', ')}
`)
  cli.showHelp(1)
}

/**
 * Global handle for all task2 task errors.
 *
 * @param {*} errors - an unknown error array
 */
function handleTaskError(errors) {
  console.log()
  console.log(errors)
  process.exit(1)
}

/**
 * Retrive GitLab services to do GitLab tasks.
 */
function getGitLabServices() {
  if (!process.env.GITLAB_ACCESS_TOKEN) {
    throw new Error('Could not get GitLab Access Token')
  }
  return new ProjectsBundle({
    host: process.env.GITLAB_HOST,
    token: process.env.GITLAB_ACCESS_TOKEN,
  })
}

const cleanWorkingTreeTask = {
  title: 'Checking working tree',
  skip: () => allowDirty,
  task: async () => {
    const { stdout } = await execa('git', ['status', '--short'])
    if (stdout) {
      throw new Error('Working tree is not clean')
    }
    return Promise.resolve()
  },
}

const taskOptions = {
  renderer: renderer,
}

//
// ---------------------------------------------------------------------------------------
// Tasks
//

/**
 * Create a release.
 *
 * @see {@link https://github.com/muuvmuuv/melody/blob/master/IDEA.md#release}
 */
class Release {
  constructor() {
    this.services = getGitLabServices()

    this.SEMVER_INCREMENTS = [
      'patch',
      'minor',
      'major',
      'prepatch',
      'preminor',
      'premajor',
      'prerelease',
    ]
  }

  run(step) {
    switch (step) {
      case 'publish':
        console.log('PUBLISH')
        break
      case 'finish':
        console.log(cyan('  Finishing current release...\n'))
        return this.finish()
      default:
        console.log(cyan('  Starting a new release...\n'))
        return this.start()
    }
  }

  start() {
    return this.__getStartTasks()
      .run()
      .catch(handleTaskError)
      .then(({ version }) => {
        this.version = version
        process.env.VERSION = version
        console.log(`
  You are now working on a new release (release/${version}).

  To publish or finish the release, use this command:

  ${dim('$')} melody release --publish|--finish
  `)
      })
  }

  __getStartTasks() {
    return new Listr(
      [
        cleanWorkingTreeTask,
        {
          title: 'Already in release branch',
          task: async () => {
            try {
              const { stdout } = await execa('git', ['branch', '--show-current'])
              const currentBranchName = stdout.trim()
              if (currentBranchName.includes('release')) {
                throw new Error(
                  'Already checked out in release branch: ' + currentBranchName
                )
              }
            } catch (error) {
              throw new Error(error)
            }
          },
        },
        {
          title: 'Prompt new version',
          task: async (ctx, task) => {
            const { releaseType } = await recommendedBump({
              preset: 'angular',
            })
            ctx.version = await task.prompt([
              {
                type: 'select',
                name: 'version',
                message: 'New version',
                initial: this.SEMVER_INCREMENTS.findIndex((inc) => inc === releaseType),
                choices: this.SEMVER_INCREMENTS.map((increment) => ({
                  name: inc(currentVersion, increment),
                  message: inc(currentVersion, increment),
                  hint:
                    releaseType === increment ? `${increment} (recommended)` : increment,
                })),
              },
            ])
          },
        },
        {
          title: 'Fetching remote branches',
          task: () => {
            return execa('git', ['fetch'])
          },
        },
        {
          title: 'Getting remote branches',
          task: async (ctx) => {
            try {
              const { stdout } = await execa('git', [
                'branch',
                '--no-color',
                '--format',
                '%(refname)',
              ])
              const branches = stdout.split('\n')
              ctx.branches = branches
            } catch (error) {
              throw new Error(error)
            }
          },
        },
        {
          title: 'Validating existing releases',
          task: (ctx) => {
            const releaseBranchName = `release/${ctx.version}`
            const existingBranch = ctx.branches.find((branch) =>
              branch.includes(releaseBranchName)
            )
            if (existingBranch) {
              throw new Error('Release branch already exists: ' + existingBranch)
            }
          },
        },
        {
          title: 'Creating new release branch',
          task: (ctx) => {
            return dryRun
              ? Promise.resolve()
              : execa('git', ['checkout', '-b', `release/${ctx.version}`])
          },
        },
        {
          title: 'Bumping package version',
          task: async (ctx) => {
            const pkgJsonPath = path.join(projectRoot, 'package.json')
            const contents = await fsPromises.readFile(pkgJsonPath)
            const json = JSON.parse(contents)
            json.version = ctx.version
            return dryRun
              ? Promise.resolve()
              : fsPromises.writeFile(pkgJsonPath, JSON.stringify(json, null, 2))
          },
        },
        {
          title: 'Bumping package lock version',
          task: async (ctx) => {
            const pkgJsonPath = path.join(projectRoot, 'package-lock.json')
            const contents = await fsPromises.readFile(pkgJsonPath)
            const json = JSON.parse(contents)
            json.version = ctx.version
            return dryRun
              ? Promise.resolve()
              : fsPromises.writeFile(pkgJsonPath, JSON.stringify(json, null, 2))
          },
        },
        {
          title: 'Generating changelog',
          task: async () => {
            try {
              let changelog = await generateChangelog()
              const changelogPath = path.join(projectRoot, 'CHANGELOG.md')
              const oldChangelog = await fsPromises.readFile(changelogPath)
              changelog = changelog + '\n\n\n\n' + oldChangelog
              if (!dryRun) {
                await fsPromises.writeFile(changelogPath, changelog)
              }
            } catch (error) {
              throw new Error(error)
            }
          },
        },
      ],
      taskOptions
    )
  }

  finish() {
    return this.__getFinishTasks()
      .run()
      .catch(handleTaskError)
      .then(() => {
        console.log(`
  Yippie! A new release has been made.

  Check out the merge request for your release here:
  ${green(underline('https://example.com'))}
`)
      })
  }

  __getFinishTasks() {
    return new Listr(
      [
        {
          title: 'Verify project',
          task: async () => {
            if (!project) {
              throw new Error('You must pass the `--project` flag to continue')
            }
            try {
              await this.services.ProjectMembers.all(project)
            } catch (error) {
              throw new Error('Project could not be found!')
            }
          },
        },
        cleanWorkingTreeTask,
        {
          title: 'Is release branch',
          task: async () => {
            try {
              const { stdout } = await execa('git', ['branch', '--show-current'])
              const currentBranchName = stdout.trim()
              if (!currentBranchName.includes('release')) {
                throw new Error(
                  'Current branch is not a release branch: ' + currentBranchName
                )
              }
            } catch (error) {
              throw new Error(error)
            }
          },
        },
        {
          title: 'Fetching remote tags',
          task: () => {
            return execa('git', ['fetch', '--tags'])
          },
        },
        {
          title: 'Tag already present',
          task: async (ctx, task) => {
            try {
              await execa(
                'git',
                ['rev-parse', '--verify', '--quiet', `"refs/tags/v${currentVersion}"`],
                { shell: true }
              )
              ctx.forceTag = await task.prompt({
                type: 'Confirm',
                message: `Tag v${currentVersion} already created, do you want to assign to a new commit?`,
                initial: true,
              })
            } catch {
              return Promise.resolve()
            }
          },
        },
        {
          title: 'Checking out to develop',
          task: () => {
            return dryRun ? Promise.resolve() : execa('git', ['checkout', 'develop'])
          },
        },
        {
          title: 'Merge into develop',
          task: () => {
            return dryRun
              ? Promise.resolve()
              : execa('git', ['merge', `release/${currentVersion}`])
          },
        },
        {
          title: 'Creating tag',
          skip: (ctx) => ctx.forceTag === false,
          task: (ctx) => {
            const args = [
              'tag',
              '--annotate',
              `v${currentVersion}`,
              '--message',
              `"chore: new tag v${currentVersion}"`,
            ]
            if (ctx.forceTag) {
              args.push('--force')
            }
            return dryRun ? Promise.resolve() : execa('git', args)
          },
        },
        {
          title: 'Pushing develop changes',
          task: () => {
            return dryRun
              ? Promise.resolve()
              : execa('git', ['push', 'origin', 'develop', '-o', 'ci.skip'])
          },
        },
        {
          title: 'Pushing release tag',
          task: () => {
            return dryRun
              ? Promise.resolve()
              : execa('git', ['push', 'origin', `v${currentVersion}`])
          },
        },
        {
          title: 'Removing local release branch',
          skip: () => !deletes,
          task: () => {
            return dryRun
              ? Promise.resolve()
              : execa('git', ['branch', '--delete', `release/${currentVersion}`])
          },
        },
        {
          title: 'Removing remote release branch',
          skip: () => !deletes,
          task: async () => {
            try {
              await execa('git', [
                'push',
                'origin',
                '--delete',
                `release/${currentVersion}`,
              ])
            } catch {
              // nothing because if it does not exists, it is OK
            }
          },
        },
        {
          title: 'Creating merge request',
          // BUG: https://github.com/jdalrymple/gitbeaker/issues/1146
          skip: () => true,
          task: async () => {
            if (dryRun) return Promise.resolve()
            try {
              const changelog = await getLatestChangelog(false)
              await this.services.MergeRequests.create({
                projectId: project,
                sourceBranch: 'develop',
                targetBranch: 'master',
                title: `New release v${currentVersion}`,
                options: {
                  description: changelog,
                  removeSourceBranch: false,
                  labels: 'release',
                  showExpanded: true,
                },
              })
            } catch (error) {
              throw new Error(error)
            }
          },
        },
      ],
      taskOptions
    )
  }
}

//
// ---------------------------------------------------------------------------------------
//

function getStep() {
  if (flags.finish) {
    return 'finish'
  } else if (flags.publish) {
    return 'publish'
  }
  return null
}

const step = getStep()

switch (task) {
  case 'release':
    const release = new Release()
    release.run(step)
    break
}
