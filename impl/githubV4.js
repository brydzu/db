#!/usr/bin/env node

'use strict';

(() => {

  const gh = require('./github');

  const repoQuery = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    name
    nameWithOwner
    isPrivate
    owner {
      login
    }
    url
    description
    isFork
    createdAt
    updatedAt
    pushedAt
    homepageUrl
    diskUsage
    stargazers {
      totalCount
    }
    primaryLanguage {
      name
    }
    mirrorUrl
    isArchived
    licenseInfo {
      key
      name
      spdxId
      url
      id
    }
    defaultBranchRef {
      name
    }
    languages(first: 100) {
      edges {
        size
        node {
          color
          name
        }
      }
    }
  }
}
`
  const repo = async (oraSpinner, errCodes, repoFullName, repoFetchedAtDate) => {
    // TODO use repoFetchedAtDate

    const dataJson = await gh.fetchGHJson('https://api.github.com/graphql', oraSpinner, errCodes, null, {
      query: repoQuery,
      variables: buildCommonRepoVariables(repoFullName),
    })

    if (!(dataJson instanceof Object)) {
      return dataJson
    }
    if (dataJson.errors) {
      switch (dataJson.errors[0].type) {
        case "NOT_FOUND":
          return 404
      }
    }

    const r = dataJson.data.repository

    let res = {}
    res.name = r.name
    res.full_name = r.nameWithOwner
    res.private = r.isPrivate
    res.owner = r.owner.login
    res.html_url = r.url
    res.description = r.description
    res.fork = r.isFork
    res.url = "https://api.github.com/repos/" + r.nameWithOwner
    res.languages_url = "https://api.github.com/repos/" + r.nameWithOwner + "/languages"
    res.pulls_url = "https://api.github.com/repos/" + r.nameWithOwner + "/pulls{/number}"

    // format: "2015-09-10T02:15:47Z"
    res.created_at = coerceDate(r.createdAt)
    res.updated_at = coerceDate(r.updatedAt)
    res.pusher_at = coerceDate(r.pushedAt)

    res.homepage = r.homepageUrl // TODO verify expected URL
    res.size = r.diskUsage
    res.stargazers_count = r.stargazers.totalCount
    res.language = r.primaryLanguage.name
    res.mirror_url = r.mirrorUrl
    res.archived = r.isArchived
    res.default_branch = r.defaultBranchRef.name

    if (r.licenseInfo) {
      res.license = {}
      res.license.key  = r.licenseInfo.key
      res.license.name  = r.licenseInfo.name
      res.license.spdx_id  = r.licenseInfo.spdxId
      res.license.url  = r.licenseInfo.url
      res.license.node_id  = r.licenseInfo.id
    }

    res.languages = {}
    for (let it of r.languages.edges) {
      res.languages[it.node.name] = {
        bytes: it.size,
        color: it.node.color,
      }
    }

    return res
  };

  const commitsQuery = `
query($owner: String!, $name: String!, $cursor: String, $since: GitTimestamp) {
  repository(owner: $owner, name: $name) {
    ref(qualifiedName: "master") {
      target {
        ... on Commit {
          history(since: $since, first: 100, after: $cursor) {
            edges {
              node {
                oid
                author {
                  date
                  user {
                    login
                  }
                }
                committer {
                  date
                  user {
                    login
                  }
                }
              }
              cursor
            }
          }
        }
      }
    }
  }
}
`
  const commits = async (oraSpinner, errCodes, repoFullName, lastFetchedCommitDateStr, page, perPage, v4cursor = null) => {

    let variables = buildCommonRepoVariables(repoFullName, page, v4cursor)
    variables.since = lastFetchedCommitDateStr
    const dataJson = await gh.fetchGHJson('https://api.github.com/graphql', oraSpinner, errCodes, null, {
      query: commitsQuery,
      variables: variables,
    })

    if (!(dataJson instanceof Object)) {
      return dataJson
    }

    let edges = dataJson.data.repository.ref.target.history.edges

    let res = []
    for (let e of edges) {
      const author = e.node.author
      const committer = e.node.committer

      res.push({
        sha: e.node.oid,
        commit: {
          author: {
            date: coerceDate(author.date),
          },
          committer: {
            date: coerceDate(committer.date),
          },
        },
        author: {
          login: author.user ? author.user.login : null,
        },
        committer: {
          login: committer.user ? committer.user.login : null,
        },
      })
    }

    insertCursor(res, edges)

    return res
  };

  const pullRequestsQuery = `
query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: 100, orderBy: {field: CREATED_AT, direction: DESC}, after: $cursor) {
      edges {
        cursor
        node {
          createdAt
          author {
            login
          }
        }
      }
    }
  }
}
`
  const pullRequests = async (oraSpinner, errCodes, repoFullName, page, perPage, v4cursor = null) => {

    const dataJson = await gh.fetchGHJson('https://api.github.com/graphql', oraSpinner, errCodes, null, {
      query: pullRequestsQuery,
      variables: buildCommonRepoVariables(repoFullName, page, v4cursor),
    })

    if (!(dataJson instanceof Object)) {
      return dataJson
    }

    let edges = dataJson.data.repository.pullRequests.edges

    let res = []
    for (let e of edges) {
      res.push({
          user: {
            login: e.node.author ? e.node.author.login : null,
          }
      })
    }

    insertCursor(res, edges)

    return res
  }

  const repoLanguages = async () => {
    throw "unexpected call to repoLanguages"
    return
  }

  module.exports = {
    repo,
    commits,
    pullRequests,
    repoLanguages,
  }

  function buildCommonRepoVariables(repoFullName, page, cursor) {
    let owner, repoName
    [owner, repoName] = repoFullName.split("/")

    let variables = {
      owner: owner,
      name: repoName,
    }

    if (isNaN(page) || page === 1) {
      return variables
    }

    if (cursor == null) {
      throw "expected cursor not null"
    }

    variables.cursor = cursor

    return variables
  }

  // TODO: Find better way.
  // Pass the cursor in the first element of the response.
  function insertCursor(resultArray, edgesArray) {
    if (resultArray.length > 0 && edgesArray.length > 0) {
      const cursor = edgesArray.slice(-1)[0].cursor
      console.log(cursor)
      resultArray[0].cursor = cursor
    }
  }

  function coerceDate(dateStr) {
    if (!dateStr) {
      return dateStr
    }
    return (new Date(dateStr)).toISOString()
  }

})();
