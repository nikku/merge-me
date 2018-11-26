const fs = require('fs');

const names = {};

const debugLogPayload = (name, content) => {

  const count = names[name] || 0;

  const suffix = count ? `_${count}`: '';

  const fileName = `${__dirname}/node_modules/${name}${suffix}.json`;

  fs.writeFileSync(fileName, JSON.stringify(content, null, '  '), 'utf-8');

  names[name] = count + 1;
};

const noopLogPayload = () => {};

const logPayload = process.env.DEBUG_LOG_PAYLOAD ? debugLogPayload : noopLogPayload;


/**
 * Main entry point of the <merge-me> probot.
 *
 * @param {import('probot').Application} app - Probot's Application class.
 */
module.exports = app => {

  async function findPullRequestByStatus(context, status) {

    logPayload('status', status);

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


    // https://octokit.github.io/rest.js/#api-PullRequests-getAll
    const {
      data: pullRequests
    } = await context.github.pullRequests.getAll(context.repo({
      ref: `${repository.name}:${branch.name}`
    }));

    context.log.debug(`found ${pullRequests.length} pulls`);

    logPayload('pulls.getAll', pullRequests);

    if (!pullRequests.length) {
      context.log('skipping: no PR matches ref');
      return null;
    }

    return pullRequests[0];
  }

  async function checkMerge(context, pullRequest) {

    const {
      number,
      head,
      base
    } = pullRequest;

    context.log.debug(`checking merge on PR #${number}`);


    // this is a PR from outside the organization
    // ensure that we got no dismissed reviews and at least
    // a single approved review before we proceed with
    // auto merging
    if (isCrossOriginPullRequest(head, base)) {

      context.log.debug('external PR, checking if review(s) exists');

      const {
        data: reviews
      } = await context.github.pullRequests.getReviews(context.repo({
        number
      }));

      const allApproved = reviews.every(function(review) {
        return review.state === 'APPROVED';
      });

      if (!reviews.length || !allApproved) {
        context.log('skipping: dismissed or missing reviews on external PR');

        return;
      }

      context.log.debug('approved via review(s)');
    }


    const sha = head.sha;

    // https://octokit.github.io/rest.js/#api-Repos-getProtectedBranchRequiredStatusChecks
    const {
      data: requiredStatusChecks
    } = await context.github.repos.getProtectedBranchRequiredStatusChecksContexts(context.repo({
      branch: base.ref
    }));

    logPayload('repos.branchRestrictions', requiredStatusChecks);

    if (requiredStatusChecks.length) {
      context.log.debug('validating merge against branch restrictions');
    } else {
      context.log.debug('validating merge against all status checks');
    }

    const canMerge = requiredStatusChecks.length ? (summary) => {

      return summary.state === 'success' || summary.statuses.every(function(status) {

        const {
          state,
          context
        } = status;

        // wait for all checks to complete
        if (state === 'pending') {
          return false;
        }

        const isRequired = requiredStatusChecks.some((ctx) => {
          return context === ctx || context.startsWith(`${ctx}/`);
        });

        return !isRequired || state === 'success';
      });
    } : (summary) => {
      return summary.state === 'success';
    };


    // https://octokit.github.io/rest.js/#api-Repos-getCombinedStatusForRef
    const {
      data: status
    } = await context.github.repos.getCombinedStatusForRef(context.repo({
      ref: sha
    }));

    context.log.debug(`branch status ${status.state}`);

    logPayload('repos.combinedStatus', status);

    if (!canMerge(status)) {
      context.log('skipping: ref merge rejected via status check');

      return;
    }


    try {
      // https://octokit.github.io/rest.js/#api-PullRequests-merge
      const {
        data: result
      } = await context.github.pullRequests.merge(context.repo({
        number,
        sha,
        merge_method: 'rebase'
      }));

      context.log.debug(`merged PR #${number}`);

      logPayload('pulls.merge', result);
    } catch (e) {
      logPayload('pulls.mergeFail', e);

      if (e.code === 405) {
        const err = JSON.parse(e.message);

        // TODO(nikku): print CANNOT AUTOMATICALLY MERGE to user (?)
        context.log(`merge #${number} failed: ${err.message}`);

        return;
      }

      context.log.error('merge failed', e);
    }
  }


  app.on('pull_request_review.submitted', async context => {
    logPayload('pullRequestReview.submitted', context.payload);

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


  app.on('pull_request.opened', async context => {
    logPayload('pullRequest.opened', context.payload);

    // check, whether PR can be merged
    return checkMerge(context, context.payload.pull_request);
  });


  app.on('pull_request.reopened', async context => {
    logPayload('pullRequest.reopened', context.payload);

    // check, whether PR can be merged
    return checkMerge(context, context.payload.pull_request);
  });


  app.on('pull_request.synchronize', async context => {
    logPayload('pullRequest.synchronize', context.payload);

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

};


// helpers ////////////////////////////

function isCrossOriginPullRequest(head, base) {
  return head.repo.owner.login !== base.repo.owner.login;
}
