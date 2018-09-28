# merge-me

[![Build Status](https://travis-ci.com/nikku/merge-me.svg?branch=master)](https://travis-ci.com/nikku/merge-me)

A GitHub App built with [Probot](https://probot.github.io) that automatically
merges your pull requestsonce all required checks pass.


## Setup

```sh
# install dependencies
npm install

# run the bot
npm start
```


## Configuration

This is a _ZERO_ configuration bot. If you'd like to configure the merge behavior
configure [branch protection](https://help.github.com/articles/about-protected-branches/)
and the app will adhere to it.


## License

[MIT](LICENSE)