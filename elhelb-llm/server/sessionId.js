const PRIVATE_SESSION_ID = /^(?:vis_[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i;

function isValidPrivateSessionId(value) {
  return typeof value === 'string' && PRIVATE_SESSION_ID.test(value);
}

module.exports = { isValidPrivateSessionId };
