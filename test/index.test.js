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


    it('should ignore queued checks', test('ignore_queued_checks'));


    it('should handle missing branch', test('no_branch'));


    it('should not merge with rejected reviews', test('unprotected_rejected_reviews'));


    it('should handle missing status and checks', test('unprotected_no_status_checks'));


    it('should handle status = failed', test('unprotected_status_failed'));

  });


  describe('general', function() {

    it('should skip already merged', test('skip_merged'));


    it('should skip draft', test('skip_draft'));


    it('should skip not rebaseable', test('skip_non_rebaseable'));

  });


  describe('error handling', function() {

    // error during getBranchProtection check
    // error during merge
    it('should handle unexpected response errors', test('response_errors'));

  });


  describe('config', function() {

    it('should consider minApprovals config', async function() {

      // in this test following YML configuration is returned within
      // repos.getContents.json files (encoded in Base64):
      //    minApprovals: 2
      //
      // listReviews API call returns 2 approved reviews.

      // given
      const recording = loadRecording('with_minapprovals_config');

      // then
      await recording.replay();
    });


    describe('team reviews', function() {

      // for team reviews tests, following YML configuration is returned within
      // repos.getContents.json files (encided in Base64):
      //
      // reviewTeams:
      // - dev
      // - design

      it('should consider reviewTeams config', async function() {

        // Scenario:
        // One person from dev team approves.
        // One person from design team approves.
        // PR is merged.

        // given
        const recording = loadRecording('review_teams_simple');

        // then
        await recording.replay();
      });


      it('should correctly handle people with multiple teams', async function() {

        // Scenario:
        //
        // dev: a, b
        // design: a, b, c
        //
        // [a] opens a pull request
        // [c] approves
        // [b] approves
        // PR gets merged.
        //
        // Since dev is configured before design inside the YAML file,
        // the approval of [b] is counted as dev approval rather than design approval.

        // given
        const recording = loadRecording('review_teams_multi_team');

        // then
        await recording.replay();
      });


      it('should not merge unless there are approvals from each configured team', async function() {

        // Scenario:
        //
        // dev: a, b, c
        // design: d
        //
        // a opens a pull request.
        // a asks for a review from b, c and d.
        // b and c approves -> no merge. (design approval is missing).

        // given
        const recording = loadRecording('review_teams_approval_missing');

        // then
        await recording.replay();
      });
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
