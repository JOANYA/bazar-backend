const pool = require('../config/db');

// "Usuario" = la tienda / tendera. Nunca devolver password_hash fuera del servicio de auth.
const CAMPOS_PUBLICOS = `id_usuario, id_admin, nombre_tienda, telefono, usuario_login, estado, fecha_creacion, updated_at`;

class UsuarioRepository {
  async buscarPorLogin(login) {
    const [rows] = await pool.query(`SELECT * FROM Usuario WHERE usuario_login = ?`, [login]);
    return rows[0] || null;
  }

  async obtenerPorId(id) {
    const [rows] = await pool.query(`SELECT * FROM Usuario WHERE id_usuario = ?`, [id]);
    return rows[0] || null;
  }

  async listarDeAdmin(idAdmin, estado) {
    const [rows] = await pool.query(
      `SELECT ${CAMPOS_PUBLICOS} FROM Usuario
       WHERE id_admin = ? ${estado ? 'AND estado = ?' : ''}
       ORDER BY nombre_tienda`,
      estado ? [idAdmin, estado] : [idAdmin]
    );
    return rows;
  }

  async obtenerDeAdmin(idAdmin, id) {
    const [rows] = await pool.query(
      `SELECT ${CAMPOS_PUBLICOS} FROM Usuario WHERE id_usuario = ? AND id_admin = ?`,
      [id, idAdmin]
    );
    return rows[0] || null;
  }

  async crear({ idAdmin, nombreTienda, telefono, login, passwordHash }) {
    const [r] = await pool.query(
      `INSERT INTO Usuario (id_admin, nombre_tienda, telefono, usuario_login, password_hash)
       VALUES (?, ?, ?, ?, ?)`,
      [idAdmin, nombreTienda, telefono, login, passwordHash]
    );
    return r.insertId;
  }

  async actualizar(id, campos) {
    const sets = Object.keys(campos).map((c) => `${c} = ?`).join(', ');
    await pool.query(`UPDATE Usuario SET ${sets} WHERE id_usuario = ?`, [...Object.values(campos), id]);
  }

  async cambiarPassword(id, passwordHash) {
    await pool.query(`UPDATE Usuario SET password_hash = ? WHERE id_usuario = ?`, [passwordHash, id]);
  }
}

class AdministradorRepository {
  async buscarPorCorreo(correo) {
    const [rows] = await pool.query(`SELECT * FROM Administrador WHERE correo = ?`, [correo]);
    return rows[0] || null;
  }
  async obtenerPorId(id) {
    const [rows] = await pool.query(`SELECT * FROM Administrador WHERE id_admin = ?`, [id]);
    return rows[0] || null;
  }
  async contar() {
    const [[f]] = await pool.query(`SELECT COUNT(*) AS n FROM Administrador`);
    return f.n;
  }
  async crear({ nombre, correo, passwordHash }) {
    const [r] = await pool.query(
      `INSERT INTO Administrador (nombre, correo, password_hash) VALUES (?, ?, ?)`,
      [nombre, correo, passwordHash]
    );
    return r.insertId;
  }
  async cambiarPassword(id, passwordHash) {
    await pool.query(`UPDATE Administrador SET password_hash = ? WHERE id_admin = ?`, [passwordHash, id]);
  }
}

module.exports = { UsuarioRepository: new UsuarioRepository(), AdministradorRepository: new AdministradorRepository() };
