const {
  loadRecording
} = require('./recording');


describe('bot', function() {

  describe('with branch protection', function() {

    it('should support basic flow', async function() {

      // given
      const recording = loadRecording('protected');

      // then
      await recording.replay();
    });


    it('should handle <check_suite.completed> events', async function() {

      // given
      const recording = loadRecording('protected_check_suite');

      // then
      await recording.replay();
    });

  });


  describe('without branch protection', function() {

    it('should merge with status', async function() {

      // given
      const recording = loadRecording('unprotected_status_only');

      // then
      await recording.replay();
    });


    it('should merge with checks', async function() {

      // given
      const recording = loadRecording('unprotected_checks_only');

      // then
      await recording.replay();
    });


    it('should handle check conclusions', async function() {

      // given
      const recording = loadRecording('unprotected_check_conclusions');

      // then
      await recording.replay();
    });


    it('should ignore queued checks', async function() {

      // given
      const recording = loadRecording('ignore_queued_checks');

      // then
      await recording.replay();
    });


    it('should handle missing branch', async function() {

      // given
      const recording = loadRecording('no_branch');

      // then
      await recording.replay();
    });


    it('should not merge with rejected reviews', async function() {

      // given
      const recording = loadRecording('unprotected_rejected_reviews');

      // then
      await recording.replay();
    });


    it('should handle missing status and checks', async function() {

      // given
      const recording = loadRecording('unprotected_no_status_checks');

      // then
      await recording.replay();
    });


    it('should handle status = failed', async function() {

      // given
      const recording = loadRecording('unprotected_status_failed');

      // then
      await recording.replay();
    });

  });


  describe('error handling', function() {

    it('should handle unexpected response errors', async function() {

      // given
      const recording = loadRecording('response_errors');

      // error during getBranchProtection check
      // error during merge

      // then
      await recording.replay();
    });

  });

});