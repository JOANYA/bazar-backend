const pool = require('../config/db');

const CAMPOS = `id_cliente, nombre, telefono, direccion, limite_credito, saldo_deudor, fecha_registro`;

class ClienteRepository {
  async listar(idUsuario, { q, qEscapado, conDeuda, limite, desplazamiento }) {
    const where = ['id_usuario = ?'];
    const params = [idUsuario];
    let orden = 'nombre ASC';
    const paramsOrden = [];

    if (q) {
      where.push('nombre LIKE ?');
      params.push(`%${qEscapado}%`);
      orden = '(nombre LIKE ?) DESC, nombre ASC'; // "Don Car..." -> los que empiezan así, primero
      paramsOrden.push(`${qEscapado}%`);
    }
    if (conDeuda) {
      where.push('saldo_deudor > 0');
      orden = 'saldo_deudor DESC, nombre ASC';
      paramsOrden.length = 0;
    }

    const [rows] = await pool.query(
      `SELECT ${CAMPOS} FROM Cliente WHERE ${where.join(' AND ')} ORDER BY ${orden} LIMIT ? OFFSET ?`,
      [...params, ...paramsOrden, limite, desplazamiento]
    );
    return rows;
  }

  async obtener(idUsuario, id, conn = pool) {
    const [rows] = await conn.query(`SELECT ${CAMPOS} FROM Cliente WHERE id_cliente = ? AND id_usuario = ?`, [id, idUsuario]);
    return rows[0] || null;
  }

  /** Bloquea la fila del cliente: dos movimientos simultáneos no pueden pisar el saldo. */
  async bloquear(conn, idUsuario, id) {
    const [rows] = await conn.query(
      `SELECT ${CAMPOS} FROM Cliente WHERE id_cliente = ? AND id_usuario = ? FOR UPDATE`,
      [id, idUsuario]
    );
    return rows[0] || null;
  }

  async crear(idUsuario, d) {
    const [r] = await pool.query(
      `INSERT INTO Cliente (id_usuario, nombre, telefono, direccion, limite_credito) VALUES (?, ?, ?, ?, ?)`,
      [idUsuario, d.nombre, d.telefono, d.direccion, d.limite_credito]
    );
    return r.insertId;
  }

  async actualizar(idUsuario, id, campos) {
    const sets = Object.keys(campos).map((c) => `${c} = ?`).join(', ');
    await pool.query(`UPDATE Cliente SET ${sets} WHERE id_cliente = ? AND id_usuario = ?`, [...Object.values(campos), id, idUsuario]);
  }

  /**
   * Cuaderno digital: registra DEUDA o PAGO y actualiza el saldo. Requiere la fila bloqueada.
   * Devuelve el saldo nuevo.
   */
  async registrarMovimiento(conn, { cliente, idVenta = null, tipo, montoCentimos, metodoPago = null, observacion = null }) {
    const monto = montoCentimos / 100;
    const saldoAnterior = Math.round(cliente.saldo_deudor * 100);
    const saldoNuevo = (tipo === 'DEUDA' ? saldoAnterior + montoCentimos : saldoAnterior - montoCentimos) / 100;

    await conn.query(
      `INSERT INTO MovimientoFiado (id_cliente, id_venta, tipo_movimiento, monto, metodo_pago, saldo_anterior, saldo_nuevo, observacion)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [cliente.id_cliente, idVenta, tipo, monto, metodoPago, saldoAnterior / 100, saldoNuevo, observacion]
    );
    await conn.query(`UPDATE Cliente SET saldo_deudor = ? WHERE id_cliente = ?`, [saldoNuevo, cliente.id_cliente]);
    cliente.saldo_deudor = saldoNuevo;
    return saldoNuevo;
  }

  async movimientos(idCliente, limite) {
    const [rows] = await pool.query(
      `SELECT id_movimiento, id_venta, tipo_movimiento, monto, metodo_pago, saldo_anterior, saldo_nuevo, fecha_hora, observacion
         FROM MovimientoFiado WHERE id_cliente = ? ORDER BY id_movimiento DESC LIMIT ?`,
      [idCliente, limite]
    );
    return rows;
  }

  async totalDeuda(idUsuario) {
    const [[f]] = await pool.query(
      `SELECT COALESCE(SUM(saldo_deudor), 0) AS total, COUNT(*) AS deudores
         FROM Cliente WHERE id_usuario = ? AND saldo_deudor > 0`,
      [idUsuario]
    );
    return f;
  }
}

module.exports = new ClienteRepository();
