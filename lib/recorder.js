/**
 * Recording utilities for debug purposes
 */

const fs = require('fs');

const LOG_FOLDER = `${__dirname}/../tmp`;

const RECORD_TRACE = process.env.RECORD_TRACE;

const TIMESTAMP = Date.now();

const RAW_TRACE = process.env.RAW_TRACE;

const filter = RAW_TRACE ? filterNoop : filterStrip;

if (RECORD_TRACE) {
  module.exports = {
    GithubApi: GithubProxy,
    log
  };
} else {
  module.exports = {
    GithubApi: getGithub,
    log: function(name, args) {}
  };
}

let trace = 0;

function log(name, data) {

  const counter = trace++;

  const traceFolder = `${LOG_FOLDER}/${TIMESTAMP}_${RECORD_TRACE}`;

  // ensure directory exists
  fs.mkdirSync(traceFolder, { recursive: true });

  const prefix = '000'.substring(String(counter).length) + counter;

  const content = {
    name,
    ...data
  };

  const fileName = `${traceFolder}/${prefix}_${name}.json`;

  fs.writeFileSync(fileName, JSON.stringify(content, filter, '  '), 'utf-8');
}

function filterNoop(key, value) {
  return value;
}

function filterStrip(key, value) {

  if (
    key === '_links' ||
    key === 'sender' ||
    key === 'installation' ||
    key === 'email' ||
    key === 'node_id' ||
    key === 'url' ||
    key === 'description' ||
    key === 'body' ||
    key === 'gravatar_id' ||
    key === 'id' ||
    key === 'verification' ||
    key === 'date' ||
    key === 'headers' ||
    key === 'request' ||
    key === 'stargazers_count' ||
    key === 'watchers_count' ||
    key === 'forks_count' ||
    key === 'open_issues_count' ||
    key === 'forks' ||
    key === 'open_issues' ||
    key === 'watchers' ||
    value === null ||
    (

      // whitelist certain boolean attributes
      typeof value === 'boolean' && !(
        key === 'rebaseable' ||
        key === 'draft' ||
        key === 'merged'
      )
    ) ||
    key.endsWith('_url') ||
    key.endsWith('_at')
  ) {
    return undefined;
  }

  return value;
}


// payload logging ////////////////////

function GithubHandlerMethodProxy(handler, fn, handlerName, methodName) {

  const recordName = `${handlerName}.${methodName}`;

  return async function(args) {

    try {
      const result = await fn.call(handler, args);

      log(recordName, {
        type: 'api-call',
        args,
        result: {
          data: result.data
        }
      });

      return result;
    } catch (error) {

      log(recordName, {
        type: 'api-call',
        args,
        result: {
          error
        }
      });

      throw error;
    }
  };
}

function GithubHandlerProxy(handler, handlerName) {

  return new Proxy(handler, {
    get: function(target, prop) {
      return GithubHandlerMethodProxy(target, target[prop], handlerName, prop);
    }
  });

}

/**
 *
 * @param {import('probot').Context} context
 * @returns import('probot').GitHubAPI
 */
function getGithub(context) {
  return context.github;
}

/** @typedef {import('probot').GitHubAPI & Proxy} ProxifiedGithub */

/**
 * @param {import('probot').Context & {
 *   github: ProxifiedGithub
 *   __proxyGithub: ProxifiedGithub
 * }} context
 * @returns import('probot').GitHubAPI
 */
function GithubProxy(context) {

  if (!context.__proxyGithub) {
    context.__proxyGithub = context.github = new Proxy(context.github, {
      get: function(target, prop) {
        return GithubHandlerProxy(target[prop], prop);
      }
    });
  }

  return context.__proxyGithub;
}