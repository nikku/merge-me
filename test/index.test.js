const { Application } = require('probot');

const mergeMe = require('..');

const { expect } = require('chai');

const { fake } = require('sinon');


function fixture(name) {
  return require(`./fixtures/${name}`);
}


describe('merge-me', () => {

  let app, github, trace;

  beforeEach(() => {
    trace = [];

    app = new Application();

    app.log = (msg) => {

      if (typeof msg === 'string' && msg.indexOf('`context.github`') === 0) {
        return;
      }

      trace.push(msg);
    };

    app.log.child = () => app.log;

    app.log.error = app.log.debug = app.log;

    app.load(mergeMe);

    // mock GitHub API
    github = {
      repos: {
        getCombinedStatusForRef: fake(function({ owner, repo, ref }) {
          expect(owner).to.eql('owner');
          expect(repo).to.eql('repo');

          if (ref === 'pending') {
            return Promise.resolve({
              data: {
                state: 'pending'
              }
            });
          }

          if (ref === 'success') {
            return Promise.resolve({
              data: {
                state: 'success'
              }
            });
          }

          if (ref === 'pending-required-complete') {
            return Promise.resolve({
              data: {
                state: 'pending',
                statuses: [
                  { context: 'foo', state: 'success' },
                  { context: 'bar/a', state: 'success' },
                  { context: 'other', state: 'pending' }
                ]
              }
            });
          }

          if (ref === 'failed-required-complete') {
            return Promise.resolve({
              data: {
                state: 'failed',
                statuses: [
                  { context: 'foo', state: 'success' },
                  { context: 'bar/a', state: 'success' },
                  { context: 'other', state: 'failed' }
                ]
              }
            });
          }

          throw new Error(`unexpected invocation ${[ owner, repo, ref ]}`);
        }),
        getProtectedBranchRequiredStatusChecksContexts: fake(function({
          owner,
          repo,
          branch
        }) {
          expect(owner).to.eql('owner');
          expect(repo).to.eql('repo');

          if (branch === 'master') {
            return Promise.resolve({
              data: []
            });
          }

          if (branch === 'master-protected') {
            return Promise.resolve({
              data: [
                'foo',
                'bar'
              ]
            });
          }

          throw new Error(`unexpected invocation ${[ owner, repo, branch ]}`);
        })
      },
      pullRequests: {
        getReviews: fake(function({ owner, repo, number }) {

          expect(owner).to.eql('owner');
          expect(repo).to.eql('repo');

          if (number === 5) {
            return Promise.resolve({
              data: [
                {
                  state: 'APPROVED'
                }
              ]
            });
          }

          if (number === 6) {
            return Promise.resolve({
              data: [
                {
                  state: 'APPROVED'
                },
                {
                  state: 'DISMISSED'
                },
                {
                  state: 'PENDING'
                }
              ]
            });
          }

          if (number === 7) {
            return Promise.resolve({ data: [] });
          }

          throw new Error('unexpected PR number');
        }),
        merge: fake(function({
          number
        }) {

          if (number === 666) {
            return Promise.reject({
              code: 1,
              message: JSON.stringify({ message: 'error' })
            });
          }

          if (number === 405) {
            return Promise.reject({
              code: 405,
              message: JSON.stringify({ message: 'error' })
            });
          }

          return Promise.resolve({
            data: {
              merged: true
            }
          });
        }),
        getAll: fake(function({
          owner,
          repo,
          ref
        }) {

          expect(owner).to.eql('owner');

          if (ref === 'repo:with-pr') {
            return Promise.resolve({
              data: fixture('pulls.getAll')
            });
          }

          if (ref === 'repo:with-pr-protected') {
            return Promise.resolve({
              data: fixture('pulls.getAll.protected')
            });
          }

          if (ref === 'repo:with-pr-pending') {
            return Promise.resolve({
              data: fixture('pulls.getAll.pending')
            });
          }

          return Promise.resolve({
            data: []
          });
        })
      }
    };

    app.auth = () => Promise.resolve(github);
  });


  describe('should integrate with hooks', function() {

    describe('status', function() {

      function verify(payloadName, expectedTrace) {

        return async () => {
          // given
          const payload = fixture(payloadName);

          // when
          await app.receive({
            name: 'status',
            payload
          });

          // then
          expect(trace).to.eql(expectedTrace);
        };

      }


      it('check pending', verify('status.pending', [
        'skipping: status == pending'
      ]));


      it('check without branch', verify('status.noBranch', [
        'skipping: no branch matches ref'
      ]));


      it('check without PR', verify('status.noPullRequest', [
        'checking branch master',
        'found 0 pulls',
        'skipping: no PR matches ref',
      ]));


      it('check protected with PR', verify('status.protected', [
        'checking branch with-pr-protected',
        'found 1 pulls',
        'checking merge on PR #1',
        'validating merge against branch restrictions',
        'branch status failed',
        'merged PR #1'
      ]));


      it('check unprotected with PR', verify('status', [
        'checking branch with-pr',
        'found 1 pulls',
        'checking merge on PR #1',
        'validating merge against via all status checks',
        'branch status success',
        'merged PR #1'
      ]));

    });


    describe('pull_request_review.submitted', function() {

      function verify(payloadName, expectedTrace) {

        return async () => {
          // given
          const payload = fixture(payloadName);

          // when
          await app.receive({
            name: 'pull_request_review.submitted',
            payload
          });

          // then
          expect(trace).to.eql(expectedTrace);
        };

      }

      it('approval', verify('pullRequestReview.approval', [
        'checking merge on PR #4',
        'validating merge against via all status checks',
        'branch status success',
        'merged PR #4'
      ]));


      it('comment', verify('pullRequestReview.comment', [
        'skipping: review in state comment'
      ]));

    });


    [ 'opened', 'reopened', 'synchronize' ].forEach(function(action) {

      describe(`pull_request.${action}`, function() {

        function verify(payloadName, expectedTrace) {

          return async () => {
            // given
            const payload = fixture(payloadName);

            // when
            await app.receive({
              name: `pull_request.${action}`,
              payload
            });

            // then
            expect(trace).to.eql(expectedTrace);
          };

        }


        it('with status', verify('pullRequest.synchronize', [
          'checking merge on PR #4',
          'validating merge against via all status checks',
          'branch status success',
          'merged PR #4'
        ]));


        it('pending statues', verify('pullRequest.pending', [
          'checking merge on PR #4',
          'validating merge against branch restrictions',
          'branch status pending',
          'skipping: ref merge rejected via status check'
        ]));


        it('merge fail generic', verify('pullRequest.mergeFail', [
          'checking merge on PR #666',
          'validating merge against via all status checks',
          'branch status success',
          'merge failed'
        ]));


        it('merge fail 405', verify('pullRequest.mergeFail.405', [
          'checking merge on PR #405',
          'validating merge against via all status checks',
          'branch status success',
          'merge #405 failed: error'
        ]));


        describe('PR from external', function() {

          it('without review', verify('pullRequest.external.noReview', [
            'checking merge on PR #7',
            'external PR, checking if review exists',
            'skipping: dismissed or missing reviews on external PR'
          ]));


          it('dismissed via review', verify('pullRequest.external.dismissed', [
            'checking merge on PR #6',
            'external PR, checking if review exists',
            'skipping: dismissed or missing reviews on external PR'
          ]));


          it('approved by review', verify('pullRequest.external.approved', [
            'checking merge on PR #5',
            'external PR, checking if review exists',
            'external PR, approved via review',
            'validating merge against via all status checks',
            'branch status success',
            'merged PR #5'
          ]));

        });

      });

    });

  });

});