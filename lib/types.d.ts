import {
  Context,
  ProbotOctokit,
  Probot
} from 'probot';

export type Octokit = InstanceType<typeof ProbotOctokit>;

export { Context, Octokit, Probot };

export type Review = {
  id: number;
  user: {
    login: string;
  };
  body: string;
  state: string;
  commit_id: string;
};

export type PullRequestBase = {
  ref: string;
};

export type Status = {
  id: number;
  sha: string;
  name: string;
  context: string;
  state: string;
  commit: {
    sha: string;
    author: {
      login: string
    };
  };
  branches: {
    name: string;
    commit: {
      sha: string;
    };
  }[];
  repository: {
    name: string;
    owner: {
      login: string;
    };
  };
};

export type Suite = {
  id: number;
  head_sha: string;
  status: string;
  conclusion: string;
  repository: {
    name: string;
    owner: {
      login: string;
    };
  };
};

export type PullRequest = {
  url: string;
  id: number;
  number: number;
  state: string;
  locked: boolean;
  title: string;
  user: {
    login: string;
  };
  body: string;
  labels: {
    name: string;
  }[];
  created_at: string;
  updated_at: string;
  closed_at: string;
  merged_at: string;
  requested_reviewers: {
    login: string;
  }[];
  requested_teams: {
    name: string;
    slug: string;
  }[];
  head: {
    ref: string;
    sha: string;
    user: {
      login: string;
    };
    repo: {
      name: string;
      full_name: string;
      owner: {
        login: string;
      };
    };
  };
  base: {
    ref: string;
    sha: string;
    user: {
      login: string;
    };
    repo: {
      name: string;
      full_name: string;
      owner: {
        login: string;
      };
    };
  };
  draft: boolean;
  merged: boolean;
  mergeable: boolean;
  rebaseable: boolean;
};
