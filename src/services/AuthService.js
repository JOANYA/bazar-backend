const bcrypt = require('bcryptjs');
const { UsuarioRepository, AdministradorRepository } = require('../repositories/UsuarioRepository');
const { generarToken } = require('../middlewares/auth');
const { noAutorizado, prohibido, solicitudInvalida, noEncontrado } = require('../utils/errores');
const { texto } = require('../utils/validaciones');

const RONDAS = 10;
const MIN_PASSWORD = 6; // tendera: simple de recordar, pero no trivial
// Hash de relleno: si el usuario no existe igual gastamos el mismo tiempo en comparar,
// para que nadie pueda descubrir qué usuarios existen midiendo la demora.
const HASH_RELLENO = bcrypt.hashSync('relleno-para-igualar-tiempos', RONDAS);
const MENSAJE_CREDENCIALES = 'Usuario o contraseña incorrectos.';

const hashear = (pw) => bcrypt.hash(pw, RONDAS);

function validarPasswordNueva(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) {
    throw solicitudInvalida(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`);
  }
  if (pw.length > 72) throw solicitudInvalida('La contraseña no puede pasar de 72 caracteres.');
  return pw;
}

class AuthService {
  async loginTienda(usuarioLogin, password) {
    const login = texto(usuarioLogin, 'El usuario', { obligatorio: true, max: 50 }).toLowerCase();
    if (typeof password !== 'string' || !password) throw solicitudInvalida('La contraseña es obligatoria.');

    const usuario = await UsuarioRepository.buscarPorLogin(login);
    const ok = await bcrypt.compare(password, usuario ? usuario.password_hash : HASH_RELLENO);
    if (!usuario || !ok) throw noAutorizado(MENSAJE_CREDENCIALES);
    // Recién con la contraseña correcta se informa del estado de la cuenta.
    if (usuario.estado !== 'ACTIVO') throw prohibido('Tu cuenta no está activa. Comunícate con soporte.');

    return {
      token: generarToken({ id: usuario.id_usuario, rol: 'tendera' }),
      tienda: this.#publicoTienda(usuario)
    };
  }

  async loginAdmin(correo, password) {
    const mail = texto(correo, 'El correo', { obligatorio: true, max: 100 }).toLowerCase();
    if (typeof password !== 'string' || !password) throw solicitudInvalida('La contraseña es obligatoria.');

    const admin = await AdministradorRepository.buscarPorCorreo(mail);
    const ok = await bcrypt.compare(password, admin ? admin.password_hash : HASH_RELLENO);
    if (!admin || !ok) throw noAutorizado(MENSAJE_CREDENCIALES);

    return {
      token: generarToken({ id: admin.id_admin, rol: 'admin' }),
      admin: { id_admin: admin.id_admin, nombre: admin.nombre, correo: admin.correo }
    };
  }

  async perfil(sesion) {
    if (sesion.rol === 'admin') {
      const a = await AdministradorRepository.obtenerPorId(sesion.id);
      if (!a) throw noEncontrado('La cuenta ya no existe.');
      return { rol: 'admin', id_admin: a.id_admin, nombre: a.nombre, correo: a.correo };
    }
    const u = await UsuarioRepository.obtenerPorId(sesion.id);
    if (!u) throw noEncontrado('La cuenta ya no existe.');
    return { rol: 'tendera', ...this.#publicoTienda(u) };
  }

  async cambiarPassword(sesion, actual, nueva) {
    validarPasswordNueva(nueva);
    const esAdmin = sesion.rol === 'admin';
    const cuenta = esAdmin
      ? await AdministradorRepository.obtenerPorId(sesion.id)
      : await UsuarioRepository.obtenerPorId(sesion.id);
    if (!cuenta) throw noEncontrado('La cuenta ya no existe.');

    const ok = typeof actual === 'string' && (await bcrypt.compare(actual, cuenta.password_hash));
    if (!ok) throw noAutorizado('La contraseña actual no es correcta.');

    const hash = await hashear(nueva);
    if (esAdmin) await AdministradorRepository.cambiarPassword(sesion.id, hash);
    else await UsuarioRepository.cambiarPassword(sesion.id, hash);
  }

  #publicoTienda(u) {
    return {
      id_usuario: u.id_usuario,
      nombre_tienda: u.nombre_tienda,
      telefono: u.telefono,
      usuario_login: u.usuario_login,
      estado: u.estado
    };
  }
}

module.exports = new AuthService();
module.exports.hashear = hashear;
module.exports.validarPasswordNueva = validarPasswordNueva;
