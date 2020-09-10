# Melody

Every command should have a `--dry-run` flag to showcase what would happen running this
command. Melody will automatically detect the provider (GitHub, GitLab, etc.) and inform
you about not yet compatible providers.

Melody should be written in a low-level programming language like Go, Nim or Deno. and it
should have tests for Linux, Windows and macOS. As well as unit tests obviously.

- [Configuration](#configuration)
- [Login](#login)
- [Feature](#feature)
- [Release](#release)

## Configuration

All configuration will be stored globally into: `~/.config/melody/config.toml`:

- tag prefix
- develop branch name
- master branch name (rename to main or something)
- login token

## Login

```
melody login gitlab

  Login into GitLab interactively (or not if flags are present), so we
  can get issues and push stuff.

  Flags:
    --token                 use your token without login
    --username              your username
    --password              your password
```

## Feature

```
melody feature <feature_name>

  Create a new feature by providing your own name.

  Current configured prefix is: feature/<feature_name>
```

```
melody feature list <...flags>

  Create a new feature by selecting an existing issue from your
  repository.

  > https://docs.gitlab.com/ee/api/issues.html

  Flags:
    --milestone             filter by milestone
    --search                search (can be combined)
    --me                    only assigned to you
    --show-closed           show closed once as well
    --label                 only with label (can be used multiple times)
    --order-by              sort by an order (default is `created_at`)
    --sort                  asc or desc sorting (default is `desc`)
```

```
melody feature share [feature_name]

  Share your current feature branch and push it to the origin. You can
  provide a name if you want to share a feature branch outside your
  checked out one. If not the current branch will be used if it is prefixed
  with the feature prefix.
```

```
melody feature finish [feature_name] <...flags>

  Finish the feature you are working on. This will delete the local and if present
  remote feature branch and merge it into the configurated **develop** branch.

  Flags:
    --fetch                 fetch for remote changes or merge conflicts (default)
```

## Release

```
melody release [version]

  Starting a new release will create a new release branch based on the
  version you choose interactively or manually. Without providing your
  own version, it will list you all semver possible version bumps and
  try to recommend you one version based on previous commits messages
  if you followed the conventional commit principe.

  You can also use this command to finish a release. If the current
  branch is an active release branch it will prompt you if you meant to
  finish now.

  Example:
    ? Select a new version - Use arrow-keys to select and return to submit.
    ❯   0.46.1
        0.47.0
        1.0.0 (recommend)
        0.46.1-0
        0.47.0-0
        1.0.0-0
        0.46.1-0
        Specific (choose your own)
```

```
melody release finish

  Finishes a release by merging your current release branch into the develop branch
  and creates a merge request against your master branch. It will also tag your current
  release version to that merge commit. After all that it deletes your local release
  branch.

  We suggest you to create a continuous release circle that automatically creates a new release
  after a successfull pipeline on a release tag and merges the tag commit into your master branch.

  Flags:
    --commit-message        the commit message for the merge (do not use something like `[skip ci]` here)
    --tag-prefix            select a tag prefix (default is `v`, can be configured globally)
```
