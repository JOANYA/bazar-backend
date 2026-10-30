const pool = require('../config/db');

class VentaRepository {
  async buscarPorUuid(conn, idUsuario, uuid) {
    const [rows] = await conn.query(
      `SELECT id_venta FROM Venta WHERE id_usuario = ? AND uuid_cliente = ?`,
      [idUsuario, uuid]
    );
    return rows[0] || null;
  }

  async insertar(conn, v) {
    const [r] = await conn.query(
      `INSERT INTO Venta (id_usuario, id_cliente, monto_total, metodo_pago, estado_venta, observaciones, uuid_cliente)
       VALUES (?, ?, ?, ?, 'Completada', ?, ?)`,
      [v.idUsuario, v.idCliente, v.montoTotal, v.metodoPago, v.observaciones, v.uuid]
    );
    return r.insertId;
  }

  async insertarDetalles(conn, idVenta, lineas) {
    // `subtotal` es columna generada por la base: no se inserta.
    await conn.query(
      `INSERT INTO DetalleVenta (id_venta, id_producto, cantidad, precio_unitario_historico, costo_unitario_historico) VALUES ?`,
      [lineas.map((l) => [idVenta, l.idProducto, l.cantidad, l.precio, l.costo])]
    );
  }

  async bloquear(conn, idUsuario, idVenta) {
    const [rows] = await conn.query(
      `SELECT id_venta, id_cliente, monto_total, metodo_pago, estado_venta
         FROM Venta WHERE id_venta = ? AND id_usuario = ? FOR UPDATE`,
      [idVenta, idUsuario]
    );
    return rows[0] || null;
  }

  async detallesBasicos(conn, idVenta) {
    const [rows] = await conn.query(`SELECT id_producto, cantidad FROM DetalleVenta WHERE id_venta = ?`, [idVenta]);
    return rows;
  }

  async marcarAnulada(conn, idVenta, motivo) {
    await conn.query(
      `UPDATE Venta SET estado_venta = 'Anulada',
              observaciones = CONCAT_WS(' | ', NULLIF(observaciones, ''), ?)
        WHERE id_venta = ?`,
      [`Anulada: ${motivo}`, idVenta]
    );
  }

  /** Ticket completo: cabecera + ítems. */
  async obtenerCompleta(idUsuario, idVenta) {
    const [[v]] = await pool.query(
      `SELECT v.id_venta, v.fecha_hora, v.monto_total, v.metodo_pago, v.estado_venta, v.observaciones,
              v.id_cliente, c.nombre AS cliente_nombre, c.saldo_deudor AS cliente_saldo_deudor
         FROM Venta v LEFT JOIN Cliente c ON c.id_cliente = v.id_cliente
        WHERE v.id_venta = ? AND v.id_usuario = ?`,
      [idVenta, idUsuario]
    );
    if (!v) return null;

    const [items] = await pool.query(
      `SELECT dv.id_producto, p.nombre, dv.cantidad, dv.precio_unitario_historico AS precio_unitario, dv.subtotal
         FROM DetalleVenta dv JOIN Producto p ON p.id_producto = dv.id_producto
        WHERE dv.id_venta = ? ORDER BY p.nombre`,
      [idVenta]
    );

    return {
      id_venta: v.id_venta,
      fecha_hora: v.fecha_hora,
      monto_total: v.monto_total,
      metodo_pago: v.metodo_pago,
      estado_venta: v.estado_venta,
      observaciones: v.observaciones,
      cliente: v.id_cliente
        ? { id_cliente: v.id_cliente, nombre: v.cliente_nombre, saldo_deudor: v.cliente_saldo_deudor }
        : null,
      items
    };
  }

  /** Listado por rango de días [desde, hasta] ambos inclusive. */
  async listar(idUsuario, { desde, hasta, metodo, estado, limite, desplazamiento }) {
    const where = ['v.id_usuario = ?', 'v.fecha_hora >= ?', 'v.fecha_hora < DATE_ADD(?, INTERVAL 1 DAY)'];
    const params = [idUsuario, desde, hasta];
    if (metodo) { where.push('v.metodo_pago = ?'); params.push(metodo); }
    if (estado) { where.push('v.estado_venta = ?'); params.push(estado); }

    const [rows] = await pool.query(
      `SELECT v.id_venta, v.fecha_hora, v.monto_total, v.metodo_pago, v.estado_venta, v.id_cliente,
              COALESCE(c.nombre, 'Público general') AS cliente,
              (SELECT COALESCE(SUM(cantidad), 0) FROM DetalleVenta WHERE id_venta = v.id_venta) AS unidades
         FROM Venta v LEFT JOIN Cliente c ON c.id_cliente = v.id_cliente
        WHERE ${where.join(' AND ')}
        ORDER BY v.fecha_hora DESC, v.id_venta DESC
        LIMIT ? OFFSET ?`,
      [...params, limite, desplazamiento]
    );
    return rows;
  }
}

module.exports = new VentaRepository();
