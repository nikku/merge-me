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