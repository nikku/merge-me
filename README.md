# merge-me

[![Build Status](https://travis-ci.com/nikku/merge-me.svg?branch=master)](https://travis-ci.com/nikku/merge-me)
[![codecov](https://codecov.io/gh/nikku/merge-me/branch/master/graph/badge.svg)](https://codecov.io/gh/nikku/merge-me)

A GitHub App built with [Probot](https://probot.github.io) that merges your pull requests once all required checks pass.


## Installation

Consume as [GitHub app](https://github.com/apps/merge-me) or fork and deploy your own instance.


## Features

* Zero configuration
* Enforces [branch protection rules](https://help.github.com/articles/about-protected-branches/), if configured
* Applies [sensible defaults](#merge-rules) in the absence of branch protection
* Merges using the _rebase_ strategy


## Merge Rules

In the absence of [branch protection rules](https://help.github.com/articles/about-protected-branches/) the app ensures a pull request meets the following conditions before merging:

* There exists _at least one_ status check
* All status checks are _completed_
* All status checks got the outcome _successful_ or _neutral_
* There exists at least a single approved review
* No reviewer requested changes


## Setup

```sh
# install dependencies
npm install

# run the bot
npm start
```


## License

[MIT](LICENSE)
