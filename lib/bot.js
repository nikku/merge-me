const {
  findPullRequestByStatus,
  findPullRequestByShallowRef,
  checkMerge
} = require('./core');

const {
  log
} = require('./recorder');

/**
 * @typedef { { app: Probot } } ApplicationOptions
 *
 * @typedef { import('./types').Octokit } Octokit
 * @typedef { import('./types').Probot } Probot
 * @typedef { import('./types').Context } AnyContext
 *
 * @typedef { import('probot').Context<import('@octokit/webhooks').EventPayloads.WebhookPayloadCheckSuite> } CheckSuiteContext
 * @typedef { import('probot').Context<import('@octokit/webhooks').EventPayloads.WebhookPayloadPullRequest> } PullRequestContext
 * @typedef { import('probot').Context<import('@octokit/webhooks').EventPayloads.WebhookPayloadPullRequestReview> } PullRequestReviewContext
 * @typedef { import('probot').Context<import('@octokit/webhooks').EventPayloads.WebhookPayloadStatus> } StatusContext
 */

/**
 * Main entry point of the <merge-me> probot.
 *
 * @param {ApplicationOptions} options
 */
module.exports = ({ app }) => {

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
  logEvent(context);

  const {
    check_suite
  } = context.payload;

  const {
    conclusion,
    pull_requests
  } = check_suite;

  if (conclusion !== 'success') {
    context.log.info(`skipping: check_suite conclusion == ${conclusion}`);
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
  logEvent(context);

  const {
    review,
    pull_request
  } = context.payload;

  if (review.state !== 'approved') {
    context.log.info(`skipping: review in state ${review.state}`);

    return;
  }

  // fetch pull request with full details
  const pullRequest = await findPullRequestByShallowRef(context, pull_request);

  // check, whether PR can be merged
  await checkMerge(context, pullRequest);
}

/**
 * Handle `pull_request.*` events.
 *
 * @param {PullRequestContext} context
 */
async function handlePullRequest(context) {
  logEvent(context);

  // check, whether PR can be merged
  await checkMerge(context, context.payload.pull_request);
}

/**
 * Handle `status` event.
 *
 * @param {StatusContext} context
 */
async function handleStatus(context) {

  logEvent(context);

  const {
    state
  } = context.payload;

  if (state !== 'success') {
    context.log.info(`skipping: status == ${state}`);
    return;
  }

  const pullRequest = await findPullRequestByStatus(context, context.payload);

  if (!pullRequest) {
    return;
  }

  // check, whether PR can be merged
  await checkMerge(context, pullRequest);
}

/**
 * @param {AnyContext} context
 */
async function handleAnyEvent(context) {

  const {
    name,
    payload
  } = context;

  const {
    action
  } = payload;

  const eventName = action ? `${name}.${action}` : name;

  log(eventName, {
    type: 'event',
    payload
  });
}

/**
 * @param {AnyContext} context
 */
function logEvent(context) {

  const {
    name,
    payload
  } = context;

  const {
    action
  } = payload;

  const eventName = action ? `${name}.${action}` : name;

  context.log.debug(`processing ${eventName}`);
}