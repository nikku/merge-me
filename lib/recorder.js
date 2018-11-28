/**
 * Recording utilities for debug purposes
 */

const fs = require('fs');

const LOG_FOLDER = `${__dirname}/../tmp`;

const RECORD_TRACE = process.env.RECORD_TRACE;

if (RECORD_TRACE) {
  module.exports = {
    GithubApi: GithubProxy,
    record
  };
} else {
  module.exports = {
    GithubApi: function(context) {
      return context.github;
    },
    record: function(name, args) {}
  };
}

let trace = 0;

function record(name, data) {

  const counter = trace++;

  const traceFolder = `${LOG_FOLDER}/${RECORD_TRACE}`;

  if (!fs.existsSync(LOG_FOLDER)) {
    fs.mkdirSync(LOG_FOLDER);
  }

  if (!fs.existsSync(traceFolder)) {
    fs.mkdirSync(traceFolder);
  }

  const prefix = '000'.substring(String(counter).length) + counter;

  const content = {
    name,
    ...data
  };

  const fileName = `${traceFolder}/${prefix}_${name}.json`;

  fs.writeFileSync(fileName, JSON.stringify(content, stripPayload, '  '), 'utf-8');
}

function stripPayload(key, value) {
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
    value === null ||
    typeof value === 'boolean' ||
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

      record(recordName, {
        type: 'api-call',
        args,
        result: {
          data: result.data
        }
      });

      return result;
    } catch (error) {

      record(recordName, {
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