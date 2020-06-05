# Changelog

All notable changes to [merge-me](https://github.com/nikku/merge-me) are documented here. We use [semantic versioning](http://semver.org/) for releases.

## Unreleased

___Note:__ Yet to be released changes appear here._

## 0.6.1

* `CHORE`: log merge failure reason
* `FIX`: complete missing bits in probot update

## 0.6.0

* `FEAT`: add ability to account for per-team approval checks ([#13](https://github.com/nikku/merge-me/pull/13))
* `FEAT`: search for default configuration in `.github` repository, too
* `CHORE`: various debug logging improvements
* `CHORE`: update to `probot@9.11`

### BREAKING CHANGES:

* Now requires the `members: read` permission in order to execute per-team approval checks.

## 0.5.0

* `FEAT`: account for pull-request `rebaseable`, `merged` and `draft` meta-data to speed up merge check
* `FIX`: properly account for insignificant check suites

## 0.4.1

* `DOCS`: various documentation improvements

## 0.4.0

* `FEAT`: ignore queued checks for pull request approval

## 0.3.2

* `FIX`: workaround broken Codecov app checks ([#7](https://github.com/nikku/merge-me/issues/7))

## 0.3.1

_Publish of `v0.3.0` to npm._

## 0.3.0

* `CHORE`: rename to `@nikku/merge-me` to allow publishing to npm

## 0.2.0

* `FEAT`: support [checks](https://developer.github.com/v3/checks/) ([#3](https://github.com/nikku/merge-me/issues/3))
* `FEAT`: improve merge rules without branch protection ([#4](https://github.com/nikku/merge-me/issues/4))
* `CHORE`: refactor bot core to be easier to comprehend and test

#### Breaking Changes

* Since the bot now integrates with checks, it requires read permissions for it ([#3](https://github.com/nikku/merge-me/issues/3)).
* In the absence of branch protection the default amount of reviews required before a pull request is merged is now one, independent of the source of the pull request ([#4](https://github.com/nikku/merge-me/issues/4)).


## 0.1.0

_Initial version._
