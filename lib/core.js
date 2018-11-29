const {
  GithubApi
} = require('./recorder');


const DEFAULT_MIN_APPROVALS = 1;

const APPROVED = 'APPROVED';
const REVIEWS_MISSING = 'REVIEWS_MISSING';
const CHANGES_REQUESTED = 'CHANGES_REQUESTED';

const SUCCESS = 'SUCCESS';
const CHECKS_MISSING = 'CHECKS_MISSING';
const CHECKS_PENDING = 'CHECKS_PENDING';
const CHECKS_FAILED = 'CHECKS_FAILED';

/**
 * Extract the _effective_ reviews from the review history.
 *
 * This essentially groups the reviews by reviewer and
 * only takes the last review into account.
 *
 * @param  {List<Review>} reviews
 *
 * @return {List<Review>} effective reviews
 */
function getEffectiveReviews(reviews) {

  const userReviews = { };

  const effectiveReviews = [];

  for (let i = reviews.length - 1; i >= 0; i--) {

    const review = reviews[i];

    const userLogin = review.user.login;

    // we already found a user review with precedence
    if (userReviews[userLogin]) {
      continue;
    }

    effectiveReviews.unshift(review);
    userReviews[userLogin] = true;
  }

  return effectiveReviews;
}

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
    await GithubApi(context).repos.getBranchProtection(
      context.repo({
        branch: base.ref
      })
    );

    return true;
  } catch (e) {

    if (e.code === 404) {
      const err = JSON.parse(e.message);

      if (err.message === 'Branch not protected') {
        return false;
      }
    }

    context.log.error('failed to fetch branch protection status', e);

    return null;
  }

}


/**
 * Return pull request for a given status.
 *
 * @param {Context} context
 * @param {Status} status
 *
 * @return {Promise<PullRequest>}
 */
async function findPullRequestByStatus(context, status) {

  const {
    sha,
    repository,
    branches
  } = status;

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
  } = await GithubApi(context).pullRequests.list(context.repo({
    ref: `${repository.name}:${branch.name}`,
    state: 'open'
  }));

  context.log.debug(`found ${pullRequests.length} pulls`);

  if (!pullRequests.length) {
    context.log('skipping: no PR matches ref');
    return null;
  }

  return pullRequests[0];
}


/**
 * Return the review approval state for the given pull request.
 *
 * @param {Context} context
 * @param {PullRequest} pullRequest
 *
 * @return {Promise<String>} approval state
 */
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

  // https://octokit.github.io/rest.js/#api-PullRequests-listReviews
  const {
    data: reviews
  } = await GithubApi(context).pullRequests.listReviews(context.repo({
    number
  }));

  const effectiveReviews = getEffectiveReviews(reviews);

  const allApproved = effectiveReviews.filter(review => review.state === APPROVED);
  const allRejected = effectiveReviews.filter(review => review.state === CHANGES_REQUESTED);

  if (allApproved.length < minApprovals) {
    context.log.debug(`skipping: #${number} lacks minApprovals=${minApprovals}`);

    return REVIEWS_MISSING;
  }

  if (allRejected.length > 0) {
    context.log.debug(`skipping: #${number} reviews request changes`);

    return CHANGES_REQUESTED;
  }

  context.log.debug(`#${number} approved via review(s)`);

  return APPROVED;
}

const CODECOV_APP_ID = 254;

/**
 * Filter suites that are relevant for checks approval.
 *
 * This currently excludes neutral, completed suites
 * as well as queued Codecov checks.
 *
 * @param {Suite} suite
 *
 * @return {Boolean}
 */
function isStatusRelevantSuite(suite) {

  // ignore Codecov, as they don't report
  // propper checks (yet)
  if (suite.status === 'queued' && suite.app.id === CODECOV_APP_ID) {
    return false;
  }

  // regard all uncompleted suites as relevant
  if (suite.status !== 'completed') {
    return true;
  }

  // ignore neutral suites
  if (suite.conclusion === 'neutral') {
    return false;
  }

  return true;
}

/**
 * Combine an existing status with the one reported
 * by another suite.
 *
 * @param {String} status
 * @param {Suite} suite
 *
 * @return {String} combined status
 */
function combineSuiteStatus(status, suite) {

  if (status && status !== SUCCESS) {
    return status;
  }

  if (suite.status !== 'completed') {
    return CHECKS_PENDING;
  }

  if (suite.conclusion !== 'success') {
    return CHECKS_FAILED;
  }

  return SUCCESS;
}

/**
 * Return the status approval state for a given pull request.
 *
 * @param {Context} context
 * @param {PullRequest} pullRequest
 *
 * @return {Promise<String>}
 */
async function getStatusApproval(context, pullRequest) {

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
  } = await GithubApi(context).repos.getCombinedStatusForRef(context.repo({
    ref: sha
  }));

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

  // https://octokit.github.io/rest.js/#api-Checks-listSuitesForRef
  const {
    data: suitesForRef
  } = await GithubApi(context).checks.listSuitesForRef(context.repo({
    ref: sha
  }));

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
  const checkSuitesStatus =
    check_suites
      .filter(isStatusRelevantSuite)
      .reduce(combineSuiteStatus, null);

  // returns CHECKS_FAILED || CHECKS_PENDING || SUCCESS
  return checkSuitesStatus || CHECKS_MISSING;
}


/**
 * Check whether the pull request can be merged.
 *
 * @param {Context} context
 * @param {PullRequest} pullRequest
 *
 * @return {Promise<Boolean>}
 */
async function canMerge(context, pullRequest) {

  const {
    number,
    base
  } = pullRequest;

  const branchProtected = await isBranchProtected(context, base);

  // handle the situation that the branch protection status
  // could not be retrieved
  if (branchProtected === null) {
    return false;
  }

  // we always attempt to merge if a branch is protected;
  // GitHub enforces the protection and our merge will fail
  if (branchProtected) {
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

  const statusApproval = await getStatusApproval(context, pullRequest);

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
 * Attempt to merge the given pull request.
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
    await GithubApi(context).pullRequests.merge(context.repo({
      number,
      sha,
      merge_method: 'rebase'
    }));

    return true;
  } catch (e) {
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


/**
 * Check whether a given pull request should be merged.
 *
 * @param {Context} context
 * @param {PullRequest} pullRequest
 *
 * @return {Promise<Boolean>} true, if pull request got merged
 */
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


// helpers ////////////////////////////

function isCrossOriginPullRequest(pullRequest) {

  const {
    head,
    base
  } = pullRequest;

  return head.repo.fullName !== base.repo.fullName;
}


// module exports //////////////////////////////

module.exports = {
  isBranchProtected,
  findPullRequestByStatus,
  getReviewApproval,
  getStatusApproval,
  canMerge,
  merge,
  checkMerge
};