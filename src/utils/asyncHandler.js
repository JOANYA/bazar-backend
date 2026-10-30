const { responderError } = require('./errores');

/**
 * Envuelve un controlador async para no repetir try/catch en cada uno.
 * Cualquier error cae en responderError.
 */
const manejar = (fn, mensajePorDefecto) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch((e) => responderError(e, res, mensajePorDefecto));

module.exports = manejar;
