'use strict';

// Stand-in for decode-uri-component, which Expo Router uses (through query-string) to read links.
// Versions up to 0.4.2 can be made extremely slow by crafted input (GHSA-w573-4hg7-7wgq), and the
// fixed 0.5 can't be loaded the way query-string loads it. This does the same job in one pass:
// decode what's valid, and keep any malformed escapes as they are instead of throwing.

function decodeEach(run) {
  return run.replace(/%[0-9a-fA-F]{2}/g, (escape) => {
    try {
      return decodeURIComponent(escape);
    } catch {
      return escape;
    }
  });
}

function decode(encodedURI) {
  if (typeof encodedURI !== 'string') {
    throw new TypeError('Expected `encodedURI` to be of type `string`, got `' + typeof encodedURI + '`');
  }

  try {
    return decodeURIComponent(encodedURI);
  } catch {
    // Decode each run of escapes on its own, so one bad escape doesn't spoil the rest
    return encodedURI.replace(/(?:%[0-9a-fA-F]{2})+/g, (run) => {
      try {
        return decodeURIComponent(run);
      } catch {
        return decodeEach(run);
      }
    });
  }
}

module.exports = decode;
module.exports.default = decode;
