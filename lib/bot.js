const {
  findPullRequestByStatus,
  findPullRequestByShallowRef,
  checkMerge
} = require('./core');

const {
  log
} = require('./recorder');

/**
 * @typedef {import('probot').Context<import('@octokit/webhooks').WebhookPayloadCheckSuite>} CheckSuiteContext
 * @typedef {import('probot').Context<import('@octokit/webhooks').WebhookPayloadPullRequest>} PullRequestContext
 * @typedef {import('probot').Context<import('@octokit/webhooks').WebhookPayloadPullRequestReview>} PullRequestReviewContext
 * @typedef {import('probot').Context<import('@octokit/webhooks').WebhookPayloadStatus>} StatusContext
 */

/**
 * Main entry point of the <merge-me> probot.
 *
 * @param {import('probot').Application} app - Probot's Application class.
 */
module.exports = app => {

  // event registrations ///////////////////////////

  app.on('check_suite.completed', handleCheckSuiteCompleted);

  app.on('pull_request_review.submitted', handlePullRequestReviewSubmitted);

  app.on([
    'pull_request.opened',
    'pull_request.reopened',
    'pull_request.synchronize',
    'pull_request.ready_for_review'
  ], handlePullRequest);

  app.on('status', handleStatus);

  app.on('*', handleAnyEvent);
};

/**
 * Handle `check_suite.completed` event.
 *
 * @param {CheckSuiteContext} context
 */
async function handleCheckSuiteCompleted(context) {
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

    await checkMerge(context, pullRequest);
  }
}

/**
 * Handle `pull_request_review.submitted` event.
 *
 * @param {PullRequestReviewContext} context
 */
async function handlePullRequestReviewSubmitted(context) {
  const {
    review,
    pull_request
  } = context.payload;

  if (review.state !== 'approved') {
    context.log(`skipping: review in state ${review.state}`);

    return;
  }

  // check, whether PR can be merged
  await checkMerge(context, pull_request);
}

/**
 * Handle `pull_request.*` events.
 *
 * @param {PullRequestContext} context
 */
async function handlePullRequest(context) {

  // check, whether PR can be merged
  await checkMerge(context, context.payload.pull_request);
}

/**
 * Handle `status` event.
 *
 * @param {StatusContext} context
 */
async function handleStatus(context) {

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
  await checkMerge(context, pullRequest);
}

async function handleAnyEvent(context) {
  const {
    event,
    payload
  } = context;

  const {
    action
  } = payload;

  const eventName = action ? `${event}.${action}` : event;

  log(eventName, {
    type: 'event',
    payload
  });
}
