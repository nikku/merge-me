# Changelog

All notable changes to [merge-me](https://github.com/nikku/merge-me) are documented here. We use [semantic versioning](http://semver.org/) for releases.

## Unreleased

___Note:__ Yet to be released changes appear here._

## 0.2.0

* `FEAT`: support [checks](https://developer.github.com/v3/checks/) ([#3](https://github.com/nikku/merge-me/issues/3))
* `FEAT`: improve merge rules without branch protection ([#4](https://github.com/nikku/merge-me/issues/4))
* `CHORE`: refactor bot core to be easier to comprehend and test

#### Breaking Changes

* Since the bot now integrates with checks, it requires read permissions for it ([#3](https://github.com/nikku/merge-me/issues/3)).
* In the absence of branch protection the default amount of reviews required before a pull request is merged is now one, independent of the source of the pull request ([#4](https://github.com/nikku/merge-me/issues/4)).


## 0.1.0

_Initial version._