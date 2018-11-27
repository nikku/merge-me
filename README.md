# merge-me

[![Build Status](https://travis-ci.com/nikku/merge-me.svg?branch=master)](https://travis-ci.com/nikku/merge-me)

A GitHub App built with [Probot](https://probot.github.io) that automatically
merges your pull requests once all required checks pass.


## Installation

Consume as [GitHub app](https://github.com/apps/merge-me) or fork and deploy your own instance.


## Features

* Zero configuration
* Merges using the _rebase_ strategy
* Adheres to configured [branch protection](https://help.github.com/articles/about-protected-branches/) rules


## Merge Rules

The bot ensures that a pull request meets the following conditions before merging it:

#### With Branch Protection

* Configured [branch protection](https://help.github.com/articles/about-protected-branches/) rules are met 

#### Without Branch Protection

* There exists _at least one_ status check
* All status checks are _completed_
* All status checks got the outcome _successful_ or _neutral_
* Pull requests got at least a single approved review
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
