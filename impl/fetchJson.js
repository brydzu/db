#!/usr/bin/env node
'use strict';

(() => {

  const fetch = require('fetch-retry');

  const fetchJson = async function(url, oraSpinner, acceptedErrorCodes=[],
                                   /*Date*/ifModifiedSince, bodyObject) {
    // If the HTTP status code is 2xx, returns the object represented by the fetched json.
    // Else if the HTTP status code is in acceptedErrorCodes, returns it.
    // Else throws the HTTP status code.

    let data;
    try {
      data = await fetch(url, {
        retryOn: [500, 502, 504, 522, 525],
        headers: ifModifiedSince && {
          'If-Modified-Since': ifModifiedSince.toUTCString()
        } || null,
        method: bodyObject && 'POST' || 'GET',
        body: bodyObject && JSON.stringify(bodyObject)
      });
    } catch (e) { // we end up here after too many retries
      data = e;
    }

    const statusIsOk = Math.floor(data.status / 100) === 2;
    if (!statusIsOk && acceptedErrorCodes.indexOf(data.status) > -1) {
      return data.status;
    }

    try {
      var dataJson = await data.json();
    } catch (e) {}

    if (!statusIsOk) {
      oraSpinner && oraSpinner.fail();
      if (dataJson) {
        console.error(dataJson);
      }
      for (const envvar of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_USERNAME',
                            'GITHUB_PASSWORD']) {
        if (!process.env[envvar]) {
          console.log(`Consider setting the environment variable ${envvar}.`);
          break;
        }
      }

      throw data.status;
    }

    return dataJson;
  };

  module.exports = fetchJson;

})();
