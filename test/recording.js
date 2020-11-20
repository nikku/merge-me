const { expect } = require('chai');

const path = require('path');

const pino = require('pino');

const fs = require('fs');

const FIXTURE_BASE = `${__dirname}/fixtures`;

const { Probot } = require('probot');

const MergeMe = require('..');

function ApiCall(name) {
  return Entry('api-call', name);
}

function Event(name) {
  return Entry('event', name);
}

function Entry(type, name) {
  return `${type}:${name}`;
}

function File(path) {
  return `(${path})`;
}

class Recording {

  constructor(entries) {
    this.entries = entries;
    this.idx = 0;

    this.debug = process.env.LOG_LEVEL == 'debug';
  }

  /**
   * Trace log given message
   */
  trace(...args) {
    this.app.log(...args);
  }

  /**
   * Setup and replay recording.
   */
  async replay() {
    this.setup();

    await this.tick();

    const lastEntry = this.peek();

    if (lastEntry) {
      throw new Error(`expected all entries replayed, found left over recording (${lastEntry.file})`);
    }
  }

  /**
   * Setup recording for replay.
   */
  setup() {

    const octokit = ReplayingOctokit(this);

    const Octokit = {
      defaults: () => {
        return function Octokit() {
          return octokit;
        };
      }
    };

    const log = pino(pino.destination({
      write: (...args) => {
        console.log(...args);
      }
    }));

    const app = this.app = new Probot({
      log,
      Octokit
    });

    app.load(MergeMe);

    const logError = log.error;

    log.error = (message, error, ...args) => {

      if (message instanceof Error) {
        error = message;
      }

      this.lastError = error;

      logError.call(log, message, error, ...args);
    };

    this.app = app;
  }

  /**
   * Start simulation by draining the next
   * event on in the recording stream.
   */
  async tick() {

    let entry;

    while ((entry = this.peek())) {

      const {
        record,
        file
      } = entry;

      const {
        type,
        name,
        payload
      } = record;

      const lastError = this.lastError;

      if (type !== 'event') {

        const context = lastError
          ? `\n\tLikely caused by prior error: ${lastError.message}`
          : '';

        throw new Error(
          `expected <${Event('*')}>, found <${Entry(type, name)}> ${File(file)}${context}`
        );
      }

      // remove entry from top of recording
      this.pop();

      this.trace(`replaying <${Entry(type, name)}> ${File(file)}`);

      this.lastError = null;

      await this.app.receive({
        name,
        payload
      });

      this.trace(`replayed <${Entry(type, name)}> ${File(file)}`);
    }

  }

  /**
   * Get next recorded entry, advancing the recording.
   *
   * @return {Object} entry
   */
  pop() {
    return this.entries[this.idx++];
  }

  /**
   * Get next recorded entry without advancing the entry state.
   *
   * @return {Object} entry
   */
  peek() {
    return this.entries[this.idx];
  }

}


function loadRecording(name) {

  const dir = `${FIXTURE_BASE}/${name}`;

  const entryNames = fs.readdirSync(dir);

  const entries = entryNames.sort().map(function(entryName) {

    try {
      const file = path.relative(process.cwd(), `${dir}/${entryName}`);

      const record = JSON.parse(fs.readFileSync(file, 'utf-8'));

      return {
        file,
        record
      };
    } catch (e) {
      throw new Error(`failed to parse ${dir}/${entryName}: ${e.message}`);
    }
  });

  return new Recording(entries);
}


// replay helpers //////////////////////////////

function ReplayingOctokit(recording) {

  function ReplayingHandlerMethod(handlerName, methodName) {

    const recordName = `${handlerName}.${methodName}`;

    return async function(actualArgs) {

      recording.trace(`invoking <${ApiCall(recordName)}>`, actualArgs);

      // authenticated event check, fired by recent
      // versions of Probot once in a while
      if (isAuthenticationCheck(recordName, actualArgs)) {
        return {
          data: {
            id: 1,
            slug: 'merge-me',
            owner: {
              login: 'nikku'
            },
            permissions: {
              administration: 'read',
              checks: 'read',
              contents: 'write',
              pull_requests: 'write',
              statuses: 'read',
              members: 'read'
            },
            events: [
              'pull_request',
              'check_suite',
              'pull_request_review',
              'status'
            ]
          }
        };
      }

      // fallback config to retrieve .github/merge-me.yml file
      // from .github repository
      if (isGithubDefaultConfigFetch(recordName, actualArgs)) {
        throw Object.assign(new Error('recorded error'), { status: 404 });
      }

      // assume there is a next entry
      const entry = recording.pop();

      if (!entry) {
        throw new Error(`expected <${ApiCall(recordName)}>, found <end of recording>`);
      }

      const {
        record,
        file
      } = entry;

      const {
        type,
        name,
        args: expectedArgs,
        result
      } = record;

      if (name !== recordName || type !== 'api-call') {
        throw new Error(`expected <${Entry(type, name)}>, found <${ApiCall(recordName)}> ${File(file)}`);
      }

      recording.trace(`replaying <${Entry(type, name)}> ${File(file)}`);

      expect(actualArgs).to.eql(expectedArgs);

      const {
        error,
        data
      } = result;

      if (error) {
        throw Object.assign(new Error(error.message || 'recorded error'), error);
      }

      return {
        data
      };
    };

  }

  function ReplayingHandler(handlerName) {

    return new Proxy({}, {
      get: function(target, prop) {
        return ReplayingHandlerMethod(handlerName, prop);
      }
    });

  }

  const proxy = new Proxy({}, {
    get: function(target, prop, receiver) {

      // to support Promise.resolve(proxy);
      if (prop === 'then') {
        return;
      }

      if (prop === 'auth') {
        return function(...args) {
          return Promise.resolve(proxy);
        };
      }

      return new ReplayingHandler(prop);
    }
  });

  return proxy;
}

function isAuthenticationCheck(recordName, args) {
  return recordName === 'apps.getAuthenticated';
}

function isGithubDefaultConfigFetch(recordName, args) {
  return recordName === 'repos.getContents' && args.repo === '.github';
}

module.exports = {
  loadRecording
};