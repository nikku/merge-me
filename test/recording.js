const { expect } = require('chai');

const fs = require('fs');

const FIXTURE_BASE = `${__dirname}/fixtures`;

const { Application } = require('probot');

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

class Recording {

  constructor(entries, options = {}) {
    this.entries = entries;
    this.idx = 0;

    this.debug = options.debug;
  }

  /**
   * Trace log given message
   */
  trace(msg) {
    if (this.debug) {
      console.log(msg);
    }
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
    const github = ReplayingGithub(this);

    const app = new Application();
    app.auth = () => Promise.resolve(github);
    app.load(MergeMe);

    // disable logging unless debug is configured
    if (!this.debug) {
      app.log = () => {};
      app.log.child = () => app.log;
      app.log.error = app.log.debug = app.log;
    }

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

      if (type !== 'event') {
        throw new Error(`expected <${Event('*')}>, found <${Entry(type, name)}> (${file})`);
      }

      // remove entry from top of recording
      this.pop();

      this.trace(`replaying <${Entry(type, name)}> (${file})`);

      await this.app.receive({
        name,
        payload
      });
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


function loadRecording(name, options) {

  const dir = `${FIXTURE_BASE}/${name}`;

  const entryNames = fs.readdirSync(dir);

  const entries = entryNames.sort().map(function(entryName) {

    try {
      const file = `${dir}/${entryName}`;

      const record = JSON.parse(fs.readFileSync(file, 'utf-8'));

      return {
        file,
        record
      };
    } catch (e) {
      throw new Error(`failed to parse ${dir}/${entryName}: ${e.message}`);
    }
  });

  return new Recording(entries, options);
}


// replay helpers //////////////////////////////

function ReplayingGithub(recording) {

  function ReplayingHandlerMethod(handlerName, methodName) {

    const recordName = `${handlerName}.${methodName}`;

    return async function(actualArgs) {

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
        throw new Error(`expected <${Entry(type, name)}>, found <${ApiCall(recordName)}> (${file})`);
      }

      recording.trace(`replaying <${Entry(type, name)}> (${file})`);

      expect(actualArgs).to.eql(expectedArgs);

      const {
        error,
        data
      } = result;

      if (error) {
        throw error;
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

  return new Proxy({}, {
    get: function(target, prop) {
      return new ReplayingHandler(prop);
    }
  });

}

module.exports = {
  loadRecording
};