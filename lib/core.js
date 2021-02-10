const {
  getOctokit
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
 * @typedef { { minApprovals: number, reviewTeams: string[] } } ReviewConfig
 * @typedef { { mergeMethod: MergeMethod } } MergeConfig
 * @typedef { ReviewConfig & MergeConfig } AppConfig
 * @typedef { 'APPROVED' | 'REVIEWS_MISSING' } ApprovalState
 * @typedef { 'merge' | 'rebase' } MergeMethod
 * @typedef { 'SUCCESS' | 'CHECKS_PENDING' | 'CHECKS_FAILED' | 'CHECKS_MISSING' } ChecksState
 * @typedef { { name: string, members: string[] } } ReviewTeam
 * @typedef { { login: string } } User
 *
 * @typedef { import('./types').Review } Review
 * @typedef { import('./types').Suite } Suite
 * @typedef { import('./types').PullRequest } PullRequest
 * @typedef { import('./types').PullRequestBase} PullRequestBase
 * @typedef { import('./types').Status } Status
 *
 * @typedef { import('probot').Context<import('@octokit/webhooks').EventPayloads.WebhookPayloadCheckSuite | import('@octokit/webhooks').EventPayloads.WebhookPayloadPullRequest | import('@octokit/webhooks').EventPayloads.WebhookPayloadPullRequestReview | import('@octokit/webhooks').EventPayloads.WebhookPayloadStatus>} Context
 * @typedef { { __config?: AppConfig } } AppContext
 */

/**
 * @param {string} message
 *
 * @return {Error}
 */
function MergeCheckError(message) {

  const error = new Error(message);
  error.name = 'MergeCheckError';

  return error;
}

/**
 * @param {string} message
 *
 * @return {Error}
 */
function ConfigError(message) {

  const error = new Error(message);
  error.name = 'ConfigError';

  return error;
}

/**
 * @param {Error} err
 *
 * @return {boolean}
 */
function isMergeCheckError(err) {
  return err.name === 'MergeCheckError';
}

/**
 * @param {Error} err
 *
 * @return {boolean}
 */
function isConfigError(err) {
  return err.name === 'ConfigError';
}

/**
 * Extract the _effective_ reviews from the review history.
 *
 * This essentially groups the reviews by reviewer and
 * only takes the last review into account.
 *
 * @param  {Review[]} reviews
 * @return {Review[]} effectiveReviews
 */
function getEffectiveReviews(reviews) {

  const userReviews = /** @type { { [x: string]: boolean } } */ ({ });

  const effectiveReviews = /** @type Review[] */ ([]);

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
 * @param {Context} context
 * @param {PullRequestBase} base
 *
 * @return {Promise<boolean|null>}
 */
async function isBranchProtected(context, base) {

  try {
    await getOctokit(context).repos.getBranchProtection(
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
 * @param {Context} context
 * @param {Status} status
 *
 * @return {Promise<PullRequest|null>}
 */
async function findPullRequestByStatus(context, status) {

  const {
    sha,
    repository,
    branches
  } = status;

  // <branches> are empty for pull request states and there
  // seems no way to get from a PR commit status to the
  // actual pull request.
  //
  // We'll ignore this fact (see below), as we did not ever
  // handle that case anyway.
  //
  // Checks are the future. :^)
  //
  const branch = branches.find((branch) => {
    return branch.commit.sha === sha;
  });

  // check if PR
  if (!branch) {
    context.log.info({ sha }, 'skipping: no branch matches ref');
    return null;
  }

  context.log.debug(`checking branch ${branch.name}`);

  // we pin head to target org as external commit states
  // cannot be correlated anyway (see above)
  const head = `${repository.owner.login}:${branch.name}`;

  // https://octokit.github.io/rest.js/#api-PullRequests-list
  const {
    data: pullRequests
  } = await getOctokit(context).pulls.list(context.repo({
    head,
    state: 'open'
  }));

  context.log.debug({ sha }, `found ${pullRequests.length} pulls`);

  if (!pullRequests.length) {
    context.log.info({ sha }, 'skipping: no PR matches ref');
    return null;
  }

  return findPullRequestByShallowRef(context, pullRequests[0]);
}


/**
 * Return pull request for a given status.
 *
 * @param {Context} context
 * @param {{ number: number }} pullRequestReference
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
  } = await getOctokit(context).pulls.get(context.repo({
    pull_number: number
  }));

  return pullRequest;
}


/**
 * Return the collaborator reviews present on the given pull request
 *
 * @param {Context} context
 * @param {PullRequest} pullRequest
 *
 * @return {Promise<Review[]>} reviews
 */
async function getCollaboratorReviews(context, pullRequest) {

  const {
    number: pull_number
  } = pullRequest;

  // https://octokit.github.io/rest.js/#api-PullRequests-listReviews
  const {
    data: allReviews
  } = await getOctokit(context).pulls.listReviews(context.repo({
    pull_number,
    per_page: 100
  }));

  const effectiveReviews = getEffectiveReviews(allReviews);

  const collaboratorReviews = [];

  for (const review of effectiveReviews) {

    try {

      // https://docs.github.com/en/free-pro-team@latest/rest/reference/repos#check-if-a-user-is-a-repository-collaborator
      // 204 if collaborator, else 404
      await getOctokit(context).repos.checkCollaborator(context.repo({
        username: review.user.login
      }));

      collaboratorReviews.push(review);
    } catch (error) {

      // 404, not a collaborator
      if (error.status === 404) {
        continue;
      }

      throw error;
    }
  }

  return collaboratorReviews;
}

/**
 * Return the review approval state for the given pull request.
 *
 * @param {Context} context
 * @param {PullRequest} pullRequest
 *
 * @return {Promise<string>} approval state
 */
async function getReviewApproval(context, pullRequest) {

  const ctx = context.repo({
    pull_number: pullRequest.number
  });

  const config = await getReviewConfig(context, pullRequest);

  context.log.debug({
    ...ctx,
    config
  }, 'checking review approval');

  const reviews = await getCollaboratorReviews(context, pullRequest);

  context.log.debug(ctx, `found ${reviews.length} collaborator reviews`);

  if (reviews.some(isChangesRequested)) {
    context.log.debug(ctx, 'skipping: reviews request changes');

    return CHANGES_REQUESTED;
  }

  if (reviews.filter(isApproved).length < config.minApprovals) {
    context.log.debug(ctx, `skipping: lacks minApprovals=${config.minApprovals}`);

    return REVIEWS_MISSING;
  }

  const {
    reviewTeams
  } = config;

  if (reviewTeams.length || pullRequest.requested_teams.length) {

    const teamsApproval = await getTeamsApproval(context, pullRequest, config, reviews);

    if (teamsApproval) {
      return teamsApproval;
    }

  }

  context.log.debug(ctx, 'approved via review(s)');

  return APPROVED;
}

/**
 * @param {Review} review
 *
 * @return {boolean}
 */
function isChangesRequested(review) {
  return review.state === CHANGES_REQUESTED;
}

/**
 * @param {Review} review
 *
 * @return {boolean}
 */
function isApproved(review) {
  return review.state === APPROVED;
}

/**
 * @param {Context} context
 * @param {PullRequest} pullRequest
 *
 * @return {Promise<ReviewConfig>}
 */
async function getReviewConfig(context, pullRequest) {

  const {
    minApprovals,
    reviewTeams
  } = await getAppConfig(context);

  return {
    minApprovals: Math.max(
      isCrossOriginPullRequest(pullRequest) ? 1 : 0,
      minApprovals
    ),
    reviewTeams
  };
}

/**
 * @param {Context} context
 *
 * @return {Promise<AppConfig>}
 */
async function getAppConfig(context) {

  const appContext = /** @type AppContext */ (context);

  const cachedConfig = appContext.__config;

  if (cachedConfig) {
    return cachedConfig;
  }

  const userConfig = await context.config(CONFIG_FILE, {});

  const defaultConfig = {
    minApprovals: DEFAULT_MIN_APPROVALS,
    mergeMethod: 'rebase',
    reviewTeams: []
  };

  const config = /** @type AppConfig */ ({
    ...defaultConfig,
    ...userConfig
  });

  if (typeof config.minApprovals !== 'number' || config.minApprovals < 0) {
    throw ConfigError('config error: minApprovals must be a positive integer');
  }

  if (![ 'rebase', 'merge' ].includes(config.mergeMethod)) {
    throw ConfigError(`config error: unknown merge method <${ config.mergeMethod }>`);
  }

  appContext.__config = config;

  return config;
}

/**
 * Filter suites that are relevant for checks approval.
 *
 * This currently excludes neutral or non PR related suites.
 *
 * @param {Suite} suite
 * @param {PullRequest} pullRequest
 *
 * @return {boolean}
 */
function isStatusRelevantSuite(suite, pullRequest) {

  const {
    status,
    conclusion
  } = suite;

  const pullRequests = /** @type { { number: number }[] } */ (suite.pull_requests);

  // discard queued checks that do not relate to the
  // target pull request, for example bogus dependabot checks
  if (status === 'queued' && !pullRequests.some(pr => pr.number === pullRequest.number)) {
    return false;
  }

  // discard completed, neutral suites
  if (status === 'completed' && conclusion === 'neutral') {
    return false;
  }

  return true;
}

/**
 * Combine an existing status with the one reported
 * by another suite.
 *
 * @param {ChecksState} status
 * @param {Suite} suite
 *
 * @return {ChecksState} status
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
 * @return {Promise<string>}
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
  } = await getOctokit(context).repos.getCombinedStatusForRef(context.repo({
    ref: sha
  }));

  const {
    statuses
  } = statusForRef;

  const statusState = statusForRef.state.toUpperCase();

  // quick reject if there are unsuccessful status checks
  if (statuses.length && statusState !== SUCCESS) {

    // returns STATUS_FAILED, STATUS_PENDING
    return `STATUS_${statusState}`;
  }

  // https://octokit.github.io/rest.js/#api-Checks-listSuitesForRef
  const {
    data: suitesForRef
  } = await getOctokit(context).checks.listSuitesForRef(context.repo({
    ref: sha
  }));

  const {
    check_suites: allSuites
  } = suitesForRef;

  const relevantSuites = allSuites.filter(suite => isStatusRelevantSuite(suite, pullRequest));

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
 * @param {Context} context
 * @param {PullRequest} pullRequest
 *
 * @return {Promise<boolean>}
 */
async function canMerge(context, pullRequest) {

  const ctx = context.repo({
    pull_number: pullRequest.number
  });

  if (pullRequest.draft) {
    context.log.info(ctx, 'skipping: pull request is a draft');
    return false;
  }

  if (pullRequest.merged) {
    context.log.info(ctx, 'skipping: pull request is already merged');
    return false;
  }

  const { mergeMethod } = await getAppConfig(context);

  // rebaseable => true, false or null
  if (mergeMethod === 'rebase' && !pullRequest.rebaseable) {
    context.log.info(ctx, 'skipping: pull request is not rebaseable');
    return false;
  }

  // mergeable => true, false or null
  if (mergeMethod === 'merge' && !pullRequest.mergeable) {
    context.log.info(ctx, 'skipping: pull request is not mergeable');
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
    context.log.debug(ctx, 'branch is protected, merge check skipped');
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

  context.log.debug(ctx, 'checking status and reviews');

  // (1) verify checks + status //////////

  const statusApproval = await getStatusApproval(context, pullRequest);

  if (statusApproval !== SUCCESS) {
    context.log.info(ctx, `skipping: failed status check (${statusApproval})`);

    return false;
  }

  // (2) verify reviews ////////////

  const reviewApproval = await getReviewApproval(context, pullRequest);

  if (reviewApproval !== APPROVED) {
    context.log.info(ctx, `skipping: failed review check (${reviewApproval})`);

    return false;
  }

  context.log.debug(ctx, 'merge check passed');

  return true;
}


/**
 * Attempt to merge the given pull request.
 *
 * @param {Context} context
 * @param {PullRequest} pullRequest
 *
 * @return {Promise<boolean>} success
 */
async function merge(context, pullRequest) {

  const ctx = context.repo({
    pull_number: pullRequest.number
  });

  const {
    number,
    head
  } = pullRequest;

  const {
    sha
  } = head;

  const { mergeMethod } = await getAppConfig(context);

  context.log.debug(ctx, `attempting merge (method=${mergeMethod})`);

  try {

    // https://octokit.github.io/rest.js/#api-PullRequests-merge
    await getOctokit(context).pulls.merge(context.repo({
      pull_number: number,
      sha,
      merge_method: mergeMethod
    }));

    return true;
  } catch (error) {

    // https://developer.github.com/v3/repos/merging/

    if ('status' in error) {

      // 405 - not allowed
      // 404 - not found
      // 409 - merge conflict

      context.log.info(ctx, `merge failed (message=${error.message}, status=${error.status})`);

      return false;
    } else {
      throw error;
    }
  }
}


/**
 * Check whether a given pull request should be merged.
 *
 * @param {Context} context
 * @param {PullRequest} pullRequest
 *
 * @return {Promise<boolean>} true, if pull request got merged
 */
async function checkMerge(context, pullRequest) {

  const ctx = context.repo({
    pull_number: pullRequest.number
  });

  context.log.info(ctx, 'checking merge');

  let shouldMerge = false;

  try {
    shouldMerge = await canMerge(context, pullRequest);
  } catch (error) {

    if (isConfigError(error)) {
      context.log.warn(ctx, `skipping: ${error.message}`);
    } else if (isMergeCheckError(error)) {
      context.log.debug(ctx, `skipping: ${error.message}`);
    } else {
      throw error;
    }
  }

  if (!shouldMerge) {
    context.log.info(ctx, 'skipping: merge rejected');

    return false;
  }

  const merged = await merge(context, pullRequest);

  if (merged) {
    context.log.info(ctx, 'merged');

    return true;
  } else {
    context.log.info(ctx, 'skipping: merge failed');

    return false;
  }
}


// helpers ////////////////////////////

/**
 * @param {PullRequest} pullRequest
 *
 * @return {boolean}
 */
function isCrossOriginPullRequest(pullRequest) {

  const {
    head,
    base
  } = pullRequest;

  return head.repo.full_name !== base.repo.full_name;
}

/**
 * @param {PullRequest} pullRequest
 *
 * @return {string}
 */
function getPullRequestTargetOrg(pullRequest) {
  return pullRequest.base.repo.owner.login;
}

/**
 * @param {Context} context
 * @param {PullRequest} pullRequest
 * @param {ReviewConfig} config
 * @param {Review[]} reviews
 *
 * @return {Promise<ApprovalState>}
 */
async function getTeamsApproval(context, pullRequest, config, reviews) {

  const ctx = context.repo({
    pull_number: pullRequest.number
  });

  const {
    minApprovals,
    reviewTeams: configuredTeams
  } = config;

  const requestedTeams = pullRequest.requested_teams.map(team => team.slug);

  const reviewTeams = [
    ...requestedTeams,
    ...configuredTeams
  ].reduce(
    (teams, team) => teams.includes(team) ? teams : [ ...teams, team ],
    /** @type string[] */ ([])
  );

  const reviewers = getPullRequestReviewers(pullRequest, reviews);

  const teams = await getTeamsWithMembers(context, pullRequest, reviewTeams);

  const effectiveTeams = getEffectiveReviewTeams(teams, reviewers, requestedTeams);

  context.log.debug({
    ...ctx,
    effectiveTeams
  }, 'effective review teams');

  return getTeamsReviewApproval(context, pullRequest, reviews, effectiveTeams, minApprovals);
}


/**
 * @param {Context} context
 * @param {PullRequest} pullRequest
 * @param {Review[]} reviews
 * @param {ReviewTeam[]} teams
 * @param {number} minApprovals
 *
 * @return {Promise<ApprovalState>}
 */
async function getTeamsReviewApproval(context, pullRequest, reviews, teams, minApprovals) {

  const ctx = context.repo({
    pull_number: pullRequest.number
  });

  const approvals = reviews.filter(isApproved);

  for (const team of teams) {

    const teamsApprovals = approvals.filter(
      review => team.members.find(login => login === review.user.login)
    );

    if (teamsApprovals.length < minApprovals) {
      context.log.debug(ctx, `skipping: lacks minApprovals=${minApprovals} by team ${team.name}`);

      return REVIEWS_MISSING;
    }

    context.log.debug(ctx, `approved by team ${team.name}`);
  }

  context.log.debug(ctx, 'approved via team review(s)');

  return APPROVED;
}

/**
 * @param {PullRequest} pullRequest
 * @param {Review[]} reviews
 *
 * @return {User[]}
 */
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
 * @param {ReviewTeam[]} teams
 * @param {User[]} reviewers list of reviewer logins
 * @param {string[]} requestedTeams explicitly requested teams
 *
 * @return {ReviewTeam[]} effectiveTeams
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
 * @param {Context} context
 * @param {PullRequest} pullRequest
 * @param {string[]} reviewTeams configured review teams
 *
 * @return {Promise<ReviewTeam[]>} teams
 */
async function getTeamsWithMembers(context, pullRequest, reviewTeams) {

  const ctx = context.repo({
    pull_number: pullRequest.number
  });

  const org = getPullRequestTargetOrg(pullRequest);

  const teamMembers = await Promise.all(reviewTeams.map(async (teamSlug) => {

    const {
      data: members
    } = await getOctokit(context).teams.listMembersInOrg({
      org,
      team_slug: teamSlug
    }).catch(error => {

      context.log.debug(ctx, `failed to fetch team ${teamSlug}`, error);

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
