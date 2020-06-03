# merge-me

[![Build Status](https://travis-ci.com/nikku/merge-me.svg?branch=master)](https://travis-ci.com/nikku/merge-me)
[![Code coverage](https://img.shields.io/codecov/c/github/nikku/merge-me.svg)](https://codecov.io/gh/nikku/merge-me)

A GitHub App built with [Probot](https://probot.github.io) that merges your pull requests once all required checks pass.

![merge-me bot in action](./docs/screenshot.png)


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


## Related

This app works nicely with others:

* [WIP](https://github.com/apps/wip) - prevents merging of branches that you tag as _work in progress_
* [delete-merged-branch](https://github.com/apps/delete-merged-branch) - deletes the feature branch once merged

Combine the apps as needed for a great merge flow.


## Setup

```sh
# install dependencies
npm install

# run the bot
LOG_LEVEL=debug npm start
```


## Alternatives

Consider [probot-auto-merge](https://github.com/bobvanderlinden/probot-auto-merge) if you need a bot with more configuration options. It includes many of the features provided by [related apps](#related), too.


## License

[MIT](LICENSE)
