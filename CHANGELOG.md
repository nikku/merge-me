# Changelog

All notable changes to [merge-me](https://github.com/nikku/merge-me) are documented here. We use [semantic versioning](http://semver.org/) for releases.

## Unreleased

___Note:__ Yet to be released changes appear here._

## 0.11.1

* `FIX`: correct correlation of status updates to (local) pull requests ([`563b5cc0`](https://github.com/nikku/merge-me/commit/563b5cc02beb725c03435409a9345a64b7c71a93))

## 0.11.0

* `FIX`: correct cross-origin pull request check ([`d48ca873c`](https://github.com/nikku/merge-me/commit/d48ca873cc41f5f50e57f67e7d58d468b1f8708f))
* `FIX`: fetch full PR details before executing merge checks ([`3a69f91cf`](https://github.com/nikku/merge-me/commit/3a69f91cfc0ecaaaa15f28a626b7d1124668b381))
* `CHORE`: migrate to `probot@10`

## 0.10.0

* `CHORE`: increase page size when fetching reviews
* `FIX`: filter for collaborator reviews to decide review approvals

## 0.9.0

* `FEAT`: run on `pull_request.ready_for_review` event

## 0.8.0

_Republish of `v0.8.0`. Thanks `npm`._

## 0.7.0

* `FEAT`: account for `requested_teams` set on a PR
* `FEAT`: fail merge check if `reviewTeams` cannot be retrieved
* `FIX`: fetch full PR to account for team reviews after `check_suite.completed` events
* `CHORE`: remove unneeded listing of organizational teams

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
