const { UsuarioRepository } = require('../repositories/UsuarioRepository');
const { hashear, validarPasswordNueva } = require('./AuthService');
const { noEncontrado, conflicto, solicitudInvalida } = require('../utils/errores');
const { texto, enumerado, vacio } = require('../utils/validaciones');

const ESTADOS = ['ACTIVO', 'SUSPENDIDO', 'INACTIVO'];
const REGEX_LOGIN = /^[a-z0-9._-]{3,50}$/;

function validarTelefono(v, obligatorio) {
  const t = texto(v, 'El teléfono', { obligatorio, max: 20 });
  if (t === null) return null;
  const limpio = t.replace(/[\s-]/g, '');
  if (!/^\+?\d{6,15}$/.test(limpio)) throw solicitudInvalida('El teléfono debe tener entre 6 y 15 dígitos.');
  return limpio;
}

class TiendaAdminService {
  listar(idAdmin, estado) {
    if (!vacio(estado)) enumerado(estado, 'El estado', ESTADOS);
    return UsuarioRepository.listarDeAdmin(idAdmin, vacio(estado) ? null : estado);
  }

  async obtener(idAdmin, id) {
    const t = await UsuarioRepository.obtenerDeAdmin(idAdmin, id);
    if (!t) throw noEncontrado('Tienda no encontrada.');
    return t;
  }

  async crear(idAdmin, body = {}) {
    const nombreTienda = texto(body.nombre_tienda, 'El nombre de la tienda', { obligatorio: true, min: 2, max: 150 });
    const telefono = validarTelefono(body.telefono, true);
    const login = texto(body.usuario_login, 'El usuario de acceso', { obligatorio: true, max: 50 }).toLowerCase();
    if (!REGEX_LOGIN.test(login)) {
      throw solicitudInvalida('El usuario de acceso solo puede tener letras, números, punto, guion y guion bajo (3 a 50).');
    }
    validarPasswordNueva(body.password);

    if (await UsuarioRepository.buscarPorLogin(login)) throw conflicto('Ese usuario de acceso ya está en uso.');

    const id = await UsuarioRepository.crear({
      idAdmin, nombreTienda, telefono, login, passwordHash: await hashear(body.password)
    });
    return this.obtener(idAdmin, id);
  }

  async actualizar(idAdmin, id, body = {}) {
    await this.obtener(idAdmin, id);
    const campos = {};
    if (body.nombre_tienda !== undefined) campos.nombre_tienda = texto(body.nombre_tienda, 'El nombre de la tienda', { obligatorio: true, min: 2, max: 150 });
    if (body.telefono !== undefined) campos.telefono = validarTelefono(body.telefono, true);
    if (body.estado !== undefined) campos.estado = enumerado(body.estado, 'El estado', ESTADOS);
    if (Object.keys(campos).length === 0) throw solicitudInvalida('No enviaste ningún dato para actualizar.');
    await UsuarioRepository.actualizar(id, campos);
    return this.obtener(idAdmin, id);
  }

  async restablecerPassword(idAdmin, id, password) {
    await this.obtener(idAdmin, id);
    validarPasswordNueva(password);
    await UsuarioRepository.cambiarPassword(id, await hashear(password));
  }
}

module.exports = new TiendaAdminService();
