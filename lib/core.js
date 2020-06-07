const {
  GithubApi
} = require('./recorder');


const DEFAULT_MIN_APPROVALS = 1;

const CONFIG_FILE = 'merge-me.yml';

const APPROVED = 'APPROVED';
const REVIEWS_MISSING = 'REVIEWS_MISSING';
const CHANGES_REQUESTED = 'CHANGES_REQUESTED';

const SUCCESS = 'SUCCESS';
const CHECKS_MISSING = 'CHECKS_MISSING';
const CHECKS_PENDING = 'CHECKS_PENDING';
const CHECKS_FAILED = 'CHECKS_FAILED';

/**
 * @typedef { { draft?: boolean } } WithDraft
 * @typedef {import('probot').Context<import('@octokit/webhooks').WebhookPayloadCheckSuite | import('@octokit/webhooks').WebhookPayloadPullRequest | import('@octokit/webhooks').WebhookPayloadPullRequestReview | import('@octokit/webhooks').WebhookPayloadStatus>} ProbotContext
 * @typedef {import('@octokit/rest').Octokit.PullsListReviewsResponseItem} Review
 * @typedef {import('@octokit/rest').Octokit.ChecksListSuitesForRefResponseCheckSuitesItem} Suite
 * @typedef {import('@octokit/webhooks').WebhookPayloadStatus} Status
 * @typedef {import('@octokit/webhooks').WebhookPayloadPullRequestPullRequest | (import('@octokit/webhooks').WebhookPayloadPullRequestReviewPullRequest & WithDraft) | import('@octokit/rest').Octokit.PullsListResponseItem | import('@octokit/rest').Octokit.PullsGetResponse } PullRequest
 * @typedef {import('@octokit/webhooks').WebhookPayloadPullRequestPullRequestBase | import('@octokit/webhooks').WebhookPayloadPullRequestReviewPullRequestBase | import('@octokit/rest').Octokit.PullsListResponseItemBase | import('@octokit/rest').Octokit.PullsGetResponseBase} PullRequestBase
 */

function MergeCheckError(message) {

  const error = new Error(message);
  error.name = 'MergeCheckError';

  return error;
}

function isMergeCheckError(err) {
  return err.name === 'MergeCheckError';
}

/**
 * Extract the _effective_ reviews from the review history.
 *
 * This essentially groups the reviews by reviewer and
 * only takes the last review into account.
 *
 * @param  {Array<Review>} reviews
 *
 * @return {Array<Review>} effective reviews
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
 * @param {ProbotContext} context
 * @param {PullRequestBase} base
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
  } catch (error) {

    if (error.status === 404) {
      return false;
    }

    context.log.error('failed to fetch branch protection status', error);

    return null;
  }

}


/**
 * Return pull request for a given status.
 *
 * @param {ProbotContext} context
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
  } = await GithubApi(context).pulls.list(context.repo({
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
 * Return pull request for a given status.
 *
 * @param {ProbotContext} context
 * @param {Object} pullRequestReference
 *
 * @return {Promise<PullRequest>}
 */
async function findPullRequestByShallowRef(context, pullRequestReference) {

  const {
    number
  } = pullRequestReference;

  // https://octokit.github.io/rest.js/v16#pulls-get
  const {
    data: pullRequest
  } = await GithubApi(context).pulls.get(context.repo({
    pull_number: number
  }));

  return pullRequest;
}


/**
 * Return the review approval state for the given pull request.
 *
 * @param {ProbotContext} context
 * @param {PullRequest} pullRequest
 *
 * @return {Promise<String>} approval state
 */
async function getReviewApproval(context, pullRequest) {

  const {
    number
  } = pullRequest;

  const config = await getReviewConfig(context, pullRequest);

  context.log.debug('checking review approval', PR(pullRequest), config);

  // https://octokit.github.io/rest.js/#api-PullRequests-listReviews
  const {
    data: reviews
  } = await GithubApi(context).pulls.listReviews(context.repo({
    pull_number: number
  }));

  const effectiveReviews = getEffectiveReviews(reviews);

  if (effectiveReviews.some(isChangesRequested)) {
    context.log.debug('skipping: reviews request changes', PR(pullRequest));

    return CHANGES_REQUESTED;
  }

  if (effectiveReviews.filter(isApproved).length < config.minApprovals) {
    context.log.debug(`skipping: lacks minApprovals=${config.minApprovals}`, PR(pullRequest));

    return REVIEWS_MISSING;
  }

  const {
    reviewTeams
  } = config;

  if (reviewTeams.length || pullRequest.requested_teams.length) {

    const teamsApproval = await getTeamsApproval(context, pullRequest, config, effectiveReviews);

    if (teamsApproval) {
      return teamsApproval;
    }

  }

  context.log.debug('approved via review(s)', PR(pullRequest));

  return APPROVED;
}

function isChangesRequested(review) {
  return review.state === CHANGES_REQUESTED;
}

function isApproved(review) {
  return review.state === APPROVED;
}

async function getReviewConfig(context, pullRequest) {

  const {
    minApprovals,
    reviewTeams
  } = await context.config(CONFIG_FILE, {
    minApprovals: DEFAULT_MIN_APPROVALS,
    reviewTeams: []
  });

  return {
    minApprovals: Math.max(
      isCrossOriginPullRequest(pullRequest) ? 1 : 0,
      minApprovals
    ),
    reviewTeams
  };
}

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

  const {
    status,
    conclusion
  } = suite;

  // ignore queued suites that did not report any conclusion yet
  // this is the default behavior how Github handles checks and
  // displays these to the user.
  //
  // Example: The Codecov check is never being completed, regardless
  // a related pull request is shown as _all checks completed_.
  if (status === 'queued' && !conclusion) {
    return false;
  }

  // regard all uncompleted suites as relevant
  if (status !== 'completed') {
    return true;
  }

  // ignore neutral suites
  if (conclusion === 'neutral') {
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
 * @param {ProbotContext} context
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
    context.log.debug(`skipping: combined status == ${statusState}`);

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
    check_suites: allSuites
  } = suitesForRef;

  const relevantSuites = allSuites.filter(isStatusRelevantSuite);

  if (relevantSuites.length === 0) {

    if (statuses.length === 0) {
      return CHECKS_MISSING;
    } else {
      // SUCCESS
      return statusState;
    }
  }

  // at this point, we got at least a single check_suite
  const checkSuitesStatus = relevantSuites.reduce(combineSuiteStatus, null);

  // returns CHECKS_FAILED || CHECKS_PENDING || SUCCESS
  return checkSuitesStatus || CHECKS_MISSING;
}


/**
 * Check whether the pull request can be merged.
 *
 * @param {ProbotContext} context
 * @param {PullRequest} pullRequest
 *
 * @return {Promise<Boolean>}
 */
async function canMerge(context, pullRequest) {

  if (pullRequest.draft) {
    context.log('skipping: pull request is a draft', PR(pullRequest));

    return false;
  }

  if ('merged' in pullRequest && pullRequest.merged) {
    context.log('skipping: pull request is already merged', PR(pullRequest));

    return false;
  }

  if ('rebaseable' in pullRequest && pullRequest.rebaseable === false) {
    context.log('skipping: pull request cannot be rebased', PR(pullRequest));

    return false;
  }

  const branchProtected = await isBranchProtected(context, pullRequest.base);

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

  context.log.debug('checking status and reviews', PR(pullRequest));

  // (1) verify checks + status //////////

  const statusApproval = await getStatusApproval(context, pullRequest);

  if (statusApproval !== SUCCESS) {
    context.log(`skipping: failed status check (${statusApproval})`, PR(pullRequest));

    return false;
  }

  // (2) verify reviews ////////////

  const reviewApproval = await getReviewApproval(context, pullRequest);

  if (reviewApproval !== APPROVED) {
    context.log(`skipping: failed review check (${reviewApproval})`, PR(pullRequest));

    return false;
  }

  context.log.debug('passed merge check', PR(pullRequest));

  return true;
}


/**
 * Attempt to merge the given pull request.
 *
 * @param {ProbotContext} context
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

  context.log.debug('attempting merge', PR(pullRequest));

  try {
    // https://octokit.github.io/rest.js/#api-PullRequests-merge
    await GithubApi(context).pulls.merge(context.repo({
      pull_number: number,
      sha,
      merge_method: 'rebase'
    }));

    return true;
  } catch (error) {
    // https://developer.github.com/v3/repos/merging/

    // 405 - not allowed
    // 404 - not found
    // 409 - merge conflict

    context.log(`merge failed (message=${error.message}, status=${error.status})`, PR(pullRequest));

    return false;
  }
}


/**
 * Check whether a given pull request should be merged.
 *
 * @param {ProbotContext} context
 * @param {PullRequest} pullRequest
 *
 * @return {Promise<Boolean>} true, if pull request got merged
 */
async function checkMerge(context, pullRequest) {

  context.log('checking merge', PR(pullRequest));

  let shouldMerge = false;

  try {
    shouldMerge = await canMerge(context, pullRequest);
  } catch (err) {

    if (isMergeCheckError(err)) {
      context.log.debug(`skipping: ${err.message}`, PR(pullRequest));
    } else {
      throw err;
    }

  }

  if (!shouldMerge) {
    context.log('skipping: merge rejected', PR(pullRequest));

    return false;
  }

  const merged = await merge(context, pullRequest);

  if (merged) {
    context.log('merged', PR(pullRequest));

    return true;
  } else {
    context.log('skipping: merge failed', PR(pullRequest));

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

function getPullRequestTargetOrg(pullRequest) {
  return pullRequest.base.repo.owner.login;
}

async function getTeamsApproval(context, pullRequest, config, reviews) {

  const {
    minApprovals,
    reviewTeams: configuredTeams
  } = config;

  const requestedTeams = pullRequest.requested_teams.map(team => team.slug);

  const reviewTeams = [
    ...requestedTeams,
    ...configuredTeams
  ].reduce((teams, team) => teams.includes(team) ? teams : teams.concat(team), []);

  const reviewers = getPullRequestReviewers(pullRequest, reviews);

  const teams = await getTeamsWithMembers(context, pullRequest, reviewTeams);

  const effectiveTeams = getEffectiveReviewTeams(teams, reviewers, requestedTeams);

  context.log.debug('effective review teams', PR(pullRequest), effectiveTeams);

  return getTeamsReviewApproval(context, pullRequest, reviews, effectiveTeams, minApprovals);
}


async function getTeamsReviewApproval(context, pullRequest, reviews, teams, minApprovals) {

  const approvals = reviews.filter(isApproved);

  for (const team of teams) {

    const teamsApprovals = approvals.filter(
      review => team.members.find(login => login === review.user.login)
    );

    if (teamsApprovals.length < minApprovals) {
      context.log.debug(`skipping: lacks minApprovals=${minApprovals} by team ${team.name}`, PR(pullRequest));

      return REVIEWS_MISSING;
    }

    context.log.debug(`approved by team ${team.name}`, PR(pullRequest));
  }

  context.log.debug('approved via team review(s)', PR(pullRequest));

  return APPROVED;
}

function getPullRequestReviewers(pullRequest, reviews) {

  const {
    requested_reviewers = []
  } = pullRequest;

  return [
    ...reviews.map(r => r.user),
    ...requested_reviewers
  ];
}


/**
 * Get the actual teams required for review based on
 * all existing review teams and the assigned (or requested) reviewers.
 *
 * Users in multiple reviewTeams will be accounted for the first review team
 * they are in (based on the order in which reviewTeams are defined in the
 * configuration).
 *
 * Teams that have no members after performing the grouping are not accounted
 * for during team review approval.
 *
 * @param {Array<Object>} teams
 * @param {Array<{ login: string }>} reviewers list of reviewer logins
 * @param {Array<String>} requestedTeams explicitly requested teams
 *
 * @return {Array<Object>} effectiveTeams
 */
function getEffectiveReviewTeams(teams, reviewers, requestedTeams) {

  let remainingReviewers = reviewers.slice();

  return teams.map(team => {

    const members = team.members.filter(login => {
      const isReviewer = remainingReviewers.some(reviewer => reviewer.login === login);

      if (isReviewer) {
        remainingReviewers = remainingReviewers.filter(reviewer => reviewer.login !== login);
      }

      return isReviewer;
    });

    return {
      ...team,
      members
    };
  }).filter(team => requestedTeams.includes(team.name) || team.members.length);

}

/**
 * Fetch teams and their members via the GitHub API.
 *
 * This requires the `members` permission and may fail without it.
 *
 * This may also fail for users (not organizations) => handled gracefully.
 *
 * @param {ProbotContext} context
 * @param {PullRequest} pullRequest
 * @param {Array<string>} reviewTeams configured review teams
 *
 * @return {Promise<Array<{ name, members: Array<string> }>>} teams
 */
async function getTeamsWithMembers(context, pullRequest, reviewTeams) {

  const org = getPullRequestTargetOrg(pullRequest);

  const teamMembers = await Promise.all(reviewTeams.map(async (teamSlug) => {

    const {
      data: members
    } = await GithubApi(context).teams.listMembersInOrg({
      org,
      team_slug: teamSlug
    }).catch(error => {

      context.log.debug(`failed to fetch team ${teamSlug}`, error);

      // app is missing missing permissions
      if (error.status === 403) {
        throw MergeCheckError(`failed to fetch team ${teamSlug}`);
      }

      // app is configured for teams on user account
      if (error.status === 404) {
        throw MergeCheckError(`failed to fetch team ${teamSlug}`);
      }

      throw error;
    });

    return members;
  }));

  return reviewTeams.map(
    (teamSlug, idx) => ({
      name: teamSlug,
      members: teamMembers[idx].map(member => member.login)
    })
  );
}


function PR(pullRequest) {
  return {
    pull_number: pullRequest.number
  };
}

// module exports //////////////////////////////

module.exports = {
  isBranchProtected,
  findPullRequestByStatus,
  findPullRequestByShallowRef,
  getReviewApproval,
  getStatusApproval,
  canMerge,
  merge,
  checkMerge
};
