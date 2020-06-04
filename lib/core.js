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

  const config = await getReviewConfig(context, pullRequest);

  context.log.debug(`checking if #${number} is approved via reviews.`, config);

  // https://octokit.github.io/rest.js/#api-PullRequests-listReviews
  const {
    data: reviews
  } = await GithubApi(context).pullRequests.listReviews(context.repo({
    number
  }));

  const effectiveReviews = getEffectiveReviews(reviews);

  if (effectiveReviews.some(isChangesRequested)) {
    context.log.debug(`skipping: #${number} reviews request changes`);

    return CHANGES_REQUESTED;
  }

  if (effectiveReviews.filter(isApproved).length < config.minApprovals) {
    context.log.debug(`skipping: #${number} lacks minApprovals=${config.minApprovals}`);

    return REVIEWS_MISSING;
  }

  const {
    reviewTeams
  } = config;

  if (reviewTeams.length) {

    const teamsApproval = await getTeamsApproval(context, pullRequest, config, effectiveReviews);

    if (teamsApproval) {
      return teamsApproval;
    }

  }

  context.log.debug(`#${number} approved via review(s)`);

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
  } = await context.config('merge-me.yml', {
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

  if (pullRequest.draft) {
    context.log(`skipping: #${number} is draft`);

    return false;
  }

  if (pullRequest.merged) {
    context.log(`skipping: #${number} is already merged`);

    return false;
  }

  if (pullRequest.rebaseable === false) {
    context.log(`skipping: #${number} cannot be rebased`);

    return false;
  }

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
  } catch (error) {
    // https://developer.github.com/v3/repos/merging/

    // 405 - not allowed
    // 404 - not found
    // 409 - merge conflict

    context.log.debug(`merge #${number} failed (status=${error.status})`);

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
    context.log(`skipping: merge of #${number} rejected`);

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

function getTargetOrganization(context, pullRequest) {

  const {
    type,
    login
  } = pullRequest.base.repo.owner;

  if (type !== 'Organization') {
    return null;
  }

  return login;
}

async function getTeamsApproval(context, pullRequest, config, reviews) {

  const {
    minApprovals,
    reviewTeams
  } = config;

  const {
    number
  } = pullRequest;

  const reviewers = getPullRequestReviewers(pullRequest, reviews);

  const teams = await getTeamsWithMembers(context, pullRequest, reviewTeams);

  if (teams === null) {
    context.log(`skipping team approval for #${number}: could not fetch teams`);

    return null;
  }

  const effectiveTeams = getEffectiveReviewTeams(teams, reviewers);

  context.log.debug(`#${number} effective review teams`, effectiveTeams);

  return getTeamsReviewApproval(context, pullRequest, reviews, effectiveTeams, minApprovals);
}


async function getTeamsReviewApproval(context, pullRequest, reviews, teams, minApprovals) {

  const approvals = reviews.filter(isApproved);

  for (const team of teams) {

    const teamsApprovals = approvals.filter(
      review => team.members.find(login => login === review.user.login)
    );

    if (teamsApprovals.length < minApprovals) {
      context.log.debug(`skipping: #${pullRequest.number} lacks minApprovals=${minApprovals} by team ${team.name}`);

      return REVIEWS_MISSING;
    }

    context.log.debug(`#${pullRequest.number} approved by team ${team.name}`);
  }

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
 * @param {Array<Object>} reviewers
 *
 * @return {Array<Object>} effectiveTeams
 */
function getEffectiveReviewTeams(teams, reviewers) {

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
  }).filter(team => team.members.length);

}

/**
 * Fetch teams and their members via the GitHub API.
 *
 * This requires the `members` permission and may fail without it.
 *
 * This may also fail for users (not organizations) => handled gracefully.
 *
 * @param {ProbotContext} context
 * @param {Object} pullRequest
 * @param {Array<string>} reviewTeams configured review teams
 *
 * @return {Array<Object>} teams (team={name, members=[{ login }])
 */
async function getTeamsWithMembers(context, pullRequest, reviewTeams) {

  const org = getTargetOrganization(context, pullRequest);

  if (org === null) {
    context.log(`skipping team review check on #${pullRequest.number}: pull request target not an organization`);

    return null;
  }

  const {
    data: allTeams
  } = await GithubApi(context).teams.list({ org: org });

  const actualTeams = reviewTeams.map(teamName => allTeams.find(team => team.name === teamName)).filter(f => f);

  const teamMembers = await Promise.all(actualTeams.map(async (team) => {
    const { id } = team;

    const {
      data: members
    } = await GithubApi(context).teams.listMembers({
      org,
      team_id: id
    });

    return members;
  }));

  return actualTeams.map(
    (team, idx) => ({
      name: team.name,
      members: teamMembers[idx].map(member => member.login)
    })
  );
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
