const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { noAutorizado, prohibido } = require('../utils/errores');
const manejar = require('../utils/asyncHandler');

const SECRETO = process.env.JWT_SECRET;

if (!SECRETO) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Falta JWT_SECRET. Es obligatoria en producción: sin ella cualquiera podría fabricar tokens.');
  }
  console.warn('⚠️  JWT_SECRET no está definido: se usa una clave de desarrollo INSEGURA. Defínela en .env antes de desplegar.');
}
const CLAVE = SECRETO || 'clave_solo_para_desarrollo_local';

const EXPIRA = {
  tendera: process.env.JWT_EXPIRA_TIENDA || '7d', // una tablet de mostrador no debería pedir login a diario
  admin: process.env.JWT_EXPIRA_ADMIN || '12h'
};

/** rol: 'tendera' | 'admin' */
const generarToken = ({ id, rol }) => jwt.sign({ id, rol }, CLAVE, { expiresIn: EXPIRA[rol] });

const verificarToken = (req, res, next) => {
  const cabecera = req.headers.authorization || '';
  const [esquema, token] = cabecera.split(' ');
  if (esquema !== 'Bearer' || !token) {
    return next(noAutorizado('Debes iniciar sesión.'));
  }
  try {
    const { id, rol } = jwt.verify(token, CLAVE);
    req.sesion = { id, rol };
    next();
  } catch (_) {
    // 401 (no 403): el frontend sabe que debe llevar al login
    next(noAutorizado('Tu sesión venció. Vuelve a iniciar sesión.'));
  }
};

const soloAdmin = (req, res, next) =>
  req.sesion?.rol === 'admin' ? next() : next(prohibido('Solo el administrador puede hacer esto.'));

/**
 * Para rutas de la tienda: exige rol tendera Y que la cuenta siga ACTIVA.
 * Se consulta en cada petición para que suspender una tienda surta efecto
 * al instante, sin esperar a que venza su token.
 * Deja el id de la tienda en req.idUsuario: TODA consulta de datos debe filtrar por él.
 */
const soloTienda = manejar(async (req, res, next) => {
  if (req.sesion?.rol !== 'tendera') throw prohibido('Esta sección es solo para tiendas.');
  const [[tienda]] = await pool.query('SELECT estado FROM Usuario WHERE id_usuario = ?', [req.sesion.id]);
  if (!tienda || tienda.estado !== 'ACTIVO') {
    throw prohibido('Tu cuenta no está activa. Comunícate con soporte.');
  }
  req.idUsuario = req.sesion.id;
  next();
});

module.exports = { generarToken, verificarToken, soloAdmin, soloTienda };
