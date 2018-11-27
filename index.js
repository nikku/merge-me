const fs = require('fs');

const names = {};

const debugLogPayload = (context, name, content) => {

  const count = names[name] || 0;

  const suffix = count ? `_${count}`: '';

  const fileName = `${__dirname}/node_modules/${context.id}-${name}${suffix}.json`;

  context.log.debug(`logging payload to ${fileName}`);

  fs.writeFileSync(fileName, JSON.stringify(content, null, '  '), 'utf-8');

  names[name] = count + 1;
};

const noopLogPayload = () => {};

const logPayload = process.env.DEBUG_LOG_PAYLOAD ? debugLogPayload : noopLogPayload;

const DEFAULT_MIN_APPROVALS = 1;

const APPROVED = 'APPROVED';
const REVIEWS_MISSING = 'REVIEWS_MISSING';
const CHANGES_REQUESTED = 'CHANGES_REQUESTED';

const SUCCESS = 'SUCCESS';
const CHECKS_MISSING = 'CHECKS_MISSING';
const CHECKS_PENDING = 'CHECKS_PENDING';
const CHECKS_FAILED = 'CHECKS_FAILED';

/**
 * Main entry point of the <merge-me> probot.
 *
 * @param {import('probot').Application} app - Probot's Application class.
 */
module.exports = app => {

  /**
   * Returns a promise on whether the given branch is protected (or not).
   *
   * @param  {Context} context
   * @param  {Branch} base
   *
   * @return {Promise<Boolean>}
   */
  async function isBranchProtected(context, base) {

    try {
      const {
        data: branchProtection
      } = await context.github.repos.getBranchProtection(
        context.repo({
          branch: base.ref
        })
      );

      logPayload(context, 'repos.getBranchProtection', branchProtection);

      return true;
    } catch (e) {

      const err = JSON.parse(e.message);

      if (err.message === 'Branch not protected') {
        return false;
      }

      throw e;
    }

  }

  async function findPullRequestByStatus(context, status) {

    logPayload(context, 'status', status);

    const {
      sha,
      repository,
      branches,
      state
    } = status;


    if (state !== 'success') {
      context.log(`skipping: status == ${state}`);
      return null;
    }

    const branch = branches.find((branch) => {
      return branch.commit.sha === sha;
    });


    // check if PR
    if (!branch) {
      context.log('skipping: no branch matches ref');
      return null;
    }

    context.log.debug(`checking branch ${branch.name}`);


    // https://octokit.github.io/rest.js/#api-PullRequests-list
    const {
      data: pullRequests
    } = await context.github.pullRequests.list(context.repo({
      ref: `${repository.name}:${branch.name}`
    }));

    context.log.debug(`found ${pullRequests.length} pulls`);

    logPayload(context, 'pullRequests.list', pullRequests);

    if (!pullRequests.length) {
      context.log('skipping: no PR matches ref');
      return null;
    }

    return pullRequests[0];
  }

  async function getReviewApproval(context, pullRequest) {

    const {
      number
    } = pullRequest;

    const config = await context.config('merge-me.yml', {
      minApprovals: DEFAULT_MIN_APPROVALS
    });

    const minApprovals = Math.max(
      isCrossOriginPullRequest(pullRequest) ? 1 : 0,
      config.minApprovals
    );

    context.log.debug(`checking if #${number} is approved via reviews`);

    const {
      data: reviews
    } = await context.github.pullRequests.listReviews(context.repo({
      number
    }));

    logPayload(context, 'pullRequests.listReviews', reviews);

    const allApproved = reviews.filter(review => review.state === APPROVED);
    const allRejected = reviews.filter(review => review.state === CHANGES_REQUESTED);

    if (allApproved.length < minApprovals) {
      context.log.debug(`skipping: #${number} lacks minApprovals=${minApprovals}`);

      return REVIEWS_MISSING;
    }

    if (allRejected > 0) {
      context.log.debug(`skipping: #${number} reviews request changes`);

      return CHANGES_REQUESTED;
    }

    context.log.debug(`#${number} approved via review(s)`);

    return APPROVED;
  }

  /**
   * Return the combined status of the given PR.
   *
   * @param {Context} context
   * @param {PullRequest} pullRequest
   *
   * @return {Promise<String>}
   */
  async function getCombinedStatus(context, pullRequest) {

    // we only return SUCCESS if
    //
    // (1) there exist status or checks
    // (2) status and checks all succeed
    //

    const {
      head
    } = pullRequest;

    const {
      sha
    } = head;

    // https://octokit.github.io/rest.js/#api-Repos-getCombinedStatusForRef
    const {
      data: statusForRef
    } = await context.github.repos.getCombinedStatusForRef(context.repo({
      ref: sha
    }));

    logPayload(context, 'repos.getCombinedStatusForRef', statusForRef);

    const {
      statuses
    } = statusForRef;

    const statusState = statusForRef.state.toUpperCase();

    // quick reject if there are unsuccessful status checks
    if (statuses.length && statusState !== SUCCESS) {
      context.log.debug(`skipping: combined status = ${statusState}`);

      // returns STATUS_FAILED, STATUS_PENDING
      return `STATUS_${statusState}`;
    }

    const {
      data: suitesForRef
    } = await context.github.checks.listSuitesForRef(context.repo({
      ref: sha
    }));

    logPayload(context, 'checks.listSuitesForRef', suitesForRef);

    const {
      check_suites
    } = suitesForRef;

    if (check_suites.length === 0) {

      if (statuses.length === 0) {
        return CHECKS_MISSING;
      } else {
        // SUCCESS
        return statusState;
      }
    }

    // at this point, we got at least a single check_suite
    const checkSuitesStatus = check_suites.reduce(function(result, suite) {

      if (result && result !== SUCCESS) {
        return result;
      }

      if (suite.status !== 'completed') {
        return CHECKS_PENDING;
      }

      if (suite.conclusion !== 'neutral' && suite.conclusion !== 'success') {
        return CHECKS_FAILED;
      }

      return SUCCESS;
    }, null);

    // returns CHECKS_FAILED || CHECKS_PENDING || SUCCESS
    return checkSuitesStatus;
  }

  /**
   * Check whether the pull request can be merged.
   *
   * @param {Context} context
   * @param {PullRequest} pullRequest
   *
   * @return {Promise<String>}
   */
  async function canMerge(context, pullRequest) {

    const {
      number,
      base
    } = pullRequest;

    // we always attempt to merge if a branch is protected;
    // GitHub enforces the protection and our merge will fail
    if (await isBranchProtected(context, base)) {
      context.log.debug('branch is protected, skipping merge check');

      return true;
    }

    // in the case where branch protection is disabled
    // we will enforce the following rules:
    //
    // (1) ensure all statuses and checks are completed
    //     with result SUCCESS or NEUTRAL
    // (2) ensure there is a configured minimum amount of
    //     reviews: minimum one for external PRs and a
    //     configurable minimum of reviews for

    context.log.debug(`check #${number} status and reviews`);

    // (1) verify checks + status //////////

    const statusApproval = await getCombinedStatus(context, pullRequest);

    if (statusApproval !== SUCCESS) {
      context.log(`skipping: #${number} failed status check (${statusApproval})`);

      return false;
    }

    // (2) verify reviews ////////////

    const reviewApproval = await getReviewApproval(context, pullRequest);

    if (reviewApproval !== APPROVED) {
      context.log(`skipping: #${number} failed review check (${reviewApproval})`);

      return false;
    }

    context.log.debug('PR check passed');

    return true;
  }

  /**
   * Attempt to merge the given PR.
   *
   * @param {Context} context
   * @param {PullRequest} pullRequest
   *
   * @return {Promise<Boolean>} success
   */
  async function merge(context, pullRequest) {

    const {
      number,
      head
    } = pullRequest;

    const {
      sha
    } = head;

    context.log.debug(`attempting to merge #${number}`);

    try {
      // https://octokit.github.io/rest.js/#api-PullRequests-merge
      const {
        data: mergeResult
      } = await context.github.pullRequests.merge(context.repo({
        number,
        sha,
        merge_method: 'rebase'
      }));

      logPayload(context, 'pullRequests.merge', mergeResult);

      return true;
    } catch (e) {
      logPayload(context, 'pullRequests.merge_fail', e);

      if (e.code === 405) {
        const err = JSON.parse(e.message);

        // TODO(nikku): print CANNOT AUTOMATICALLY MERGE to user (?)
        context.log.debug(`merge #${number} failed: ${err.message}`);
      } else {
        context.log.error('merge failed', e);
      }

      return false;
    }
  }

  async function checkMerge(context, pullRequest) {

    const {
      number
    } = pullRequest;

    context.log(`checking merge of #${number}`);

    const shouldMerge = await canMerge(context, pullRequest);

    if (!shouldMerge) {
      context.log(`skipping: merge of #${number} rejected via status check`);

      return false;
    }

    const merged = await merge(context, pullRequest);

    if (merged) {
      context.log(`merged #${number}`);

      return true;
    } else {
      context.log(`skipping: failed to merge #${number}`);

      return false;
    }
  }


  // event registrations ///////////////////////////

  app.on('check_suite.completed', async context => {
    logPayload(context, 'check_suite.completed', context.payload);

    const {
      check_suite
    } = context.payload;

    const {
      pull_requests
    } = check_suite;

    if (pull_requests.length) {

      // check, whether first PR referenced by suite can be merged
      return checkMerge(context, pull_requests[0]);
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
    const pullRequest = await findPullRequestByStatus(context, context.payload);

    if (!pullRequest) {
      return;
    }

    // check, whether PR can be merged
    return checkMerge(context, pullRequest);
  });

  app.on('*', async context => {
    logPayload(context, context.event, context.payload);
  });

};


// helpers ////////////////////////////

function isCrossOriginPullRequest(pullRequest) {

  const {
    head,
    base
  } = pullRequest;

  return head.repo.id !== base.repo.id;
}
