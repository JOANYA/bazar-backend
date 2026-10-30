/**
 * Errores de negocio con código HTTP asociado.
 *   400 petición mal formada · 401 sin sesión · 403 sin permiso
 *   404 no existe · 409 conflicto con el estado actual (stock, duplicado, deuda)
 */
class ErrorNegocio extends Error {
  constructor(mensaje, status = 400) {
    super(mensaje);
    this.name = 'ErrorNegocio';
    this.status = status;
  }
}

const solicitudInvalida = (m) => new ErrorNegocio(m, 400);
const noAutorizado = (m) => new ErrorNegocio(m, 401);
const prohibido = (m) => new ErrorNegocio(m, 403);
const noEncontrado = (m) => new ErrorNegocio(m, 404);
const conflicto = (m) => new ErrorNegocio(m, 409);

/**
 * Convierte cualquier error en una respuesta HTTP coherente.
 * Nunca filtra mensajes internos de MySQL al cliente.
 */
function responderError(error, res, mensajePorDefecto = 'Error interno del servidor') {
  if (error && error.status && error.name === 'ErrorNegocio') {
    return res.status(error.status).json({ status: 'error', message: error.message });
  }

  // JSON mal formado en el body
  if (error && error.type === 'entity.parse.failed') {
    return res.status(400).json({ status: 'error', message: 'El cuerpo de la petición no es un JSON válido.' });
  }

  const codigo = error?.code || '';
  const detalle = error?.sqlMessage || '';

  if (codigo === 'ER_CHECK_CONSTRAINT_VIOLATED' && /chk_producto_stock/.test(detalle)) {
    return res.status(409).json({ status: 'error', message: 'Stock insuficiente para completar la operación.' });
  }
  if (codigo === 'ER_DUP_ENTRY') {
    return res.status(409).json({ status: 'error', message: 'Ese registro ya existe. Revisa los datos duplicados.' });
  }
  if (codigo === 'ER_NO_REFERENCED_ROW_2' || codigo === 'ER_NO_REFERENCED_ROW') {
    return res.status(400).json({ status: 'error', message: 'Se referenció un registro que no existe.' });
  }
  if (codigo === 'ER_LOCK_DEADLOCK' || codigo === 'ER_LOCK_WAIT_TIMEOUT') {
    return res.status(409).json({ status: 'error', message: 'El sistema estaba ocupado con otra operación. Intenta de nuevo.' });
  }

  console.error('❌ Error no controlado:', error);
  return res.status(500).json({ status: 'error', message: mensajePorDefecto });
}

module.exports = {
  ErrorNegocio, solicitudInvalida, noAutorizado, prohibido, noEncontrado, conflicto, responderError
};
