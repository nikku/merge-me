const {
  findPullRequestByStatus,
  findPullRequestByShallowRef,
  checkMerge
} = require('./core');

const {
  record
} = require('./recorder');


/**
 * Main entry point of the <merge-me> probot.
 *
 * @param {import('probot').Application} app - Probot's Application class.
 */
module.exports = app => {

  // event registrations ///////////////////////////

  app.on('check_suite.completed', async context => {
    const {
      check_suite
    } = context.payload;

    const {
      conclusion,
      pull_requests
    } = check_suite;

    if (conclusion !== 'success') {
      context.log(`skipping: check_suite conclusion == ${conclusion}`);
      return;
    }

    if (pull_requests.length) {

      // check, whether first PR referenced by suite can be merged
      const pullRequest = await findPullRequestByShallowRef(context, pull_requests[0]);

      if (!pullRequest) {
        return;
      }

      return checkMerge(context, pullRequest);
    }
  });

  app.on('pull_request_review.submitted', async context => {
    const {
      review,
      pull_request
    } = context.payload;

    if (review.state !== 'approved') {
      context.log(`skipping: review in state ${review.state}`);

      return;
    }

    // check, whether PR can be merged
    return checkMerge(context, pull_request);
  });

  app.on([
    'pull_request.opened',
    'pull_request.reopened',
    'pull_request.synchronize'
  ], async context => {
    // check, whether PR can be merged
    return checkMerge(context, context.payload.pull_request);
  });

  app.on('status', async context => {

    const {
      state
    } = context.payload;

    if (state !== 'success') {
      context.log(`skipping: status == ${state}`);
      return;
    }

    const pullRequest = await findPullRequestByStatus(context, context.payload);

    if (!pullRequest) {
      return;
    }

    // check, whether PR can be merged
    return checkMerge(context, pullRequest);
  });

  app.on('*', async context => {
    const {
      event,
      payload
    } = context;

    const {
      action
    } = payload;

    const eventName = action ? `${event}.${action}` : event;

    record(eventName, {
      type: 'event',
      payload
    });
  });

};