const {
  loadRecording
} = require('./recording');


describe('bot', function() {

  describe('with branch protection', function() {

    it('should support basic flow', test('protected'));


    it('should handle <check_suite.completed> events', test('protected_check_suite'));

  });


  describe('without branch protection', function() {

    it('should merge with status', test('unprotected_status_only'));


    it('should merge with checks', test('unprotected_checks_only'));


    it('should handle check conclusions', test('unprotected_check_conclusions'));


    it('should ignore Dependabot', test('unprotected_check_ignore_dependabot'));


    it('should consider queued checks', test('queued_checks'));


    it('should ignore non-PR queued checks', test('non_pull_request_queued_checks'));


    it('should consider non-PR failing checks', test('non_pull_request_failed_checks'));


    it('should handle missing branch', test('no_branch'));


    it('should not merge with rejected reviews', test('unprotected_rejected_reviews'));


    it('should ignore non-collaborator review', test('unprotected_non_collaborator_review'));


    it('should handle missing status and checks', test('unprotected_no_status_checks'));


    it('should handle status = failed', test('unprotected_status_failed'));

  });


  describe('webhooks', function() {

    it('should run on pull_request.ready_for_review', test('ready_for_review'));

  });


  describe('general', function() {

    it('should skip already merged', test('skip_merged'));


    it('should skip draft', test('skip_draft'));


    it('should skip not rebaseable', test('skip_non_rebaseable'));


    it('should skip not mergeable', test('skip_non_mergeable'));

  });


  describe('merge method', function() {

    it('should recognize <merge>', test('merge_method_merge'));

  });


  describe('error handling', function() {

    // error during getBranchProtection check
    // error during merge
    it('should handle unexpected response errors', test('response_errors'));

    // minReviews is <NaN>
    // mergeMethod is <dont-care>
    it('should handle config errors', test('config_errors'));


    it('should handle merge error', test('merge_error'));

  });


  describe('reviews', function() {

    // in this test following YML configuration is returned within
    // repos.getContents.json files (encoded in Base64):
    //    minApprovals: 2
    //
    // listReviews API call returns 2 approved reviews.
    //
    it('should consider minApprovals config', test('with_minapprovals_config'));


    describe('should consider pull_request.requested_teams', function() {

      // Scenario
      //
      // * reviewTeams=[dev]
      // * requested_teams=[outsider]
      //
      it('basic', test('requested_teams'));


      // Scenario
      //
      // * reviewTeams=[]
      // * requested_teams=[outsider]
      //
      it('no reviewTeams', test('requested_teams_no_review_teams'));


      // Scenario
      //
      // * reviewTeams=[dev, design]
      // * requested_teams=[dev]
      //
      it('handling conflict with review team', test('requested_teams_review_teams_clash'));

    });


    describe('should consider reviewTeams config', function() {

      // Scenario:
      //
      // reviewTeams:
      //   - dev (a, b)
      //   - design (a, c)
      //
      // One person from dev team approves.
      // One person from design team approves.
      // PR is merged.
      //
      it('simple scenario', test('review_teams_simple'));


      // Scenario:
      //
      // reviewTeams:
      //   - dev (a, b)
      //   - design (a, b, c)
      //
      // [a] opens a pull request
      // [c] approves
      // [b] approves
      // PR gets merged.
      //
      // Since dev is configured before design inside the YAML file,
      // the approval of [b] is counted as dev approval rather than design approval.
      //
      it('user in multiple teams', test('review_teams_user_in_multiple_teams'));


      // Scenario:
      //
      // reviewTeams:
      //   - dev (a, b, c)
      //   - design (d)
      //
      // a opens a pull request.
      // a asks for a review from b, c and d.
      // b and c approves -> no merge. (design approval is missing).
      //
      it('missing team review approval', test('review_teams_approval_missing'));


      // Scenario:
      //
      // reviewTeams:
      //   - dev (a, c)
      //   - design (b)
      //   - other (d)
      //
      // [a] opens a pull request
      // [c] approves
      // [b] approves
      //
      // PR gets merged.
      //
      it('ignoring unmentioned team', test('review_teams_ignore_unmentioned'));


      // Scenario
      //
      // reviewTeams:
      //   - dev (a, b)
      //   - design (c, d)
      //
      // PR is opened. Review is requested from a, b and c.
      //
      // b and c approves, however a rejects -> No merge.
      //
      it('rejected review', test('review_teams_with_rejects'));


      // Scenario
      //
      // * reviewTeams configured
      // * not an organization
      //
      // => basic merge rules apply
      //
      it('no organization target', test('review_teams_not_an_organization'));

    });

  });

});


// helpers /////////////

function test(recordingName) {

  return async function() {

    // given
    const recording = loadRecording(recordingName);

    // then
    await recording.replay();
  };

}
