# merge-me

[![Build Status](https://travis-ci.com/nikku/merge-me.svg?branch=master)](https://travis-ci.com/nikku/merge-me)
[![Code coverage](https://img.shields.io/codecov/c/github/nikku/merge-me.svg)](https://codecov.io/gh/nikku/merge-me)

A GitHub App that merges your pull requests once all required checks pass. 

![merge-me bot in action](./docs/screenshot.png)


## Installation

Consume as [GitHub app](https://github.com/apps/merge-me) or fork and deploy your own instance.


## Features

* Zero configuration
* Enforces [branch protection rules](https://help.github.com/articles/about-protected-branches/), if configured
* Applies [sensible defaults](#merge-rules) in the absence of branch protection
* Accounts for [review teams](#reviewteams), if configured
* Merges using the _rebase_ strategy


## Merge Rules

Without [branch protection](https://help.github.com/articles/about-protected-branches/), the app ensures a pull request meets the following conditions before merging:

* Pull request is not a draft
* At least one status check exists
* All status checks are `completed`
* All status checks have the outcome `successful` or `neutral`
* At least one review approval exists
* No review requests changes

Rules may be overridden / fine tuned with [additional configuration](#configuration).


## Configuration

You configure the merge behavior by placing a `.github/merge-me.yml` file into your repository. 

#### `minApprovals=1`

This property specifies the number of approvals required to merge a PR. Defaults to `1`, will always be at least `1` for external contributions.

##### Example

```yml
minApprovals: 2
```

#### `reviewTeams`

This property lists teams to account for when checking for approvals. Taking teams into account during the merge check requires the `members` app permission and is enabled for organizational repositories only.

If `reviewTeams` is specified, the bot checks for approvals for each team involved in the PR. It deduces the effective teams to account for via the team memberships of existing and requested reviewers. The bot merges a PR only if all effective review teams have the configured amount of `minApprovals`.

##### Example

```yml
reviewTeams:
- design
- development
```


## Related

This app works nicely with others:

* [WIP](https://github.com/apps/wip) - prevents merging of branches that you tag as _work in progress_
* [delete-merged-branch](https://github.com/apps/delete-merged-branch) - deletes the feature branch once merged

Combine the apps as needed for an excellent merge flow.


## Setup

```sh
# install dependencies
npm install

# run the bot
LOG_LEVEL=debug npm start

# test the bot
LOG_LEVEL=debug npm test
```


## Alternatives

Consider [probot-auto-merge](https://github.com/bobvanderlinden/probot-auto-merge) if you need a bot with more configuration options. It includes many of the features provided by [related apps](#related), too.


## License

[MIT](LICENSE)
