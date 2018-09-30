# merge-me

[![Build Status](https://travis-ci.com/nikku/merge-me.svg?branch=master)](https://travis-ci.com/nikku/merge-me)

A GitHub App built with [Probot](https://probot.github.io) that automatically
merges your pull requestsonce all required checks pass.


## Features

* Zero configuration
* Merges using the _rebase_ strategy
* Adheres to configured [branch protection](https://help.github.com/articles/about-protected-branches/) rules


## Merge Rules

The bot will ensure the following conditions are met before merging:

* No pending status checks
* Pull request is ready to merge according to [branch protection](https://help.github.com/articles/about-protected-branches/) rules
* Pull request from fork got reviewed by at least a single review


## Setup

```sh
# install dependencies
npm install

# run the bot
npm start
```


## License

[MIT](LICENSE)