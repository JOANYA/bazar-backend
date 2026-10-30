const pool = require('../config/db');

const RANGO_VENTA = `v.fecha_hora >= ? AND v.fecha_hora < DATE_ADD(?, INTERVAL 1 DAY)`;

class ReporteRepository {
  async ventasPorMetodo(idUsuario, fecha) {
    const [rows] = await pool.query(
      `SELECT v.metodo_pago, COUNT(*) AS n, SUM(v.monto_total) AS total
         FROM Venta v
        WHERE v.id_usuario = ? AND v.estado_venta = 'Completada' AND ${RANGO_VENTA}
        GROUP BY v.metodo_pago`,
      [idUsuario, fecha, fecha]
    );
    return rows;
  }

  /** Abonos de deudas cobrados ese día (metodo_pago NULL = reversos, no son dinero que entró). */
  async cobrosPorMetodo(idUsuario, fecha) {
    const [rows] = await pool.query(
      `SELECT m.metodo_pago, SUM(m.monto) AS total
         FROM MovimientoFiado m JOIN Cliente c ON c.id_cliente = m.id_cliente
        WHERE c.id_usuario = ? AND m.tipo_movimiento = 'PAGO' AND m.metodo_pago IS NOT NULL
          AND m.fecha_hora >= ? AND m.fecha_hora < DATE_ADD(?, INTERVAL 1 DAY)
        GROUP BY m.metodo_pago`,
      [idUsuario, fecha, fecha]
    );
    return rows;
  }

  /** Por producto: unidades, ingresos y ganancia (costo histórico; si no hay, el costo actual). */
  async productosDelDia(idUsuario, fecha) {
    const [rows] = await pool.query(
      `SELECT p.id_producto, p.nombre,
              SUM(dv.cantidad) AS unidades,
              SUM(dv.subtotal) AS ingresos,
              SUM(dv.cantidad * (dv.precio_unitario_historico - COALESCE(dv.costo_unitario_historico, p.precio_costo))) AS ganancia
         FROM DetalleVenta dv
         JOIN Venta v ON v.id_venta = dv.id_venta
         JOIN Producto p ON p.id_producto = dv.id_producto
        WHERE v.id_usuario = ? AND v.estado_venta = 'Completada' AND ${RANGO_VENTA}
        GROUP BY p.id_producto, p.nombre
        ORDER BY ganancia DESC, unidades DESC`,
      [idUsuario, fecha, fecha]
    );
    return rows;
  }

  async cierreDelDia(idUsuario, fecha) {
    const [rows] = await pool.query(
      `SELECT * FROM CierreCaja WHERE id_usuario = ? AND fecha = ?`,
      [idUsuario, fecha]
    );
    return rows[0] || null;
  }

  async guardarCierre(idUsuario, fecha, r) {
    await pool.query(
      `INSERT INTO CierreCaja (id_usuario, fecha, num_ventas, total_vendido, ventas_efectivo, ventas_yape, ventas_plin,
                               ventas_tarjeta, ventas_fiado, cobros_efectivo, cobros_digital, efectivo_en_gaveta,
                               ganancia_estimada, producto_estrella)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         num_ventas = VALUES(num_ventas), total_vendido = VALUES(total_vendido),
         ventas_efectivo = VALUES(ventas_efectivo), ventas_yape = VALUES(ventas_yape), ventas_plin = VALUES(ventas_plin),
         ventas_tarjeta = VALUES(ventas_tarjeta), ventas_fiado = VALUES(ventas_fiado),
         cobros_efectivo = VALUES(cobros_efectivo), cobros_digital = VALUES(cobros_digital),
         efectivo_en_gaveta = VALUES(efectivo_en_gaveta), ganancia_estimada = VALUES(ganancia_estimada),
         producto_estrella = VALUES(producto_estrella), fecha_hora_cierre = NOW()`,
      [idUsuario, fecha, r.num_ventas, r.total_vendido, r.ventas.efectivo, r.ventas.yape, r.ventas.plin, r.ventas.tarjeta,
       r.ventas.fiado, r.cobros_deuda.efectivo, r.cobros_deuda.digital, r.efectivo_en_gaveta,
       r.ganancia_estimada, r.producto_estrella ? r.producto_estrella.nombre : null]
    );
  }

  async historialCierres(idUsuario, limite) {
    const [rows] = await pool.query(
      `SELECT fecha, num_ventas, total_vendido, ventas_efectivo, ventas_yape, ventas_plin, ventas_tarjeta, ventas_fiado,
              cobros_efectivo, cobros_digital, efectivo_en_gaveta, ganancia_estimada, producto_estrella, fecha_hora_cierre,
              (ventas_efectivo + ventas_yape + ventas_plin + ventas_tarjeta + cobros_efectivo + cobros_digital) AS recaudacion
         FROM CierreCaja WHERE id_usuario = ? ORDER BY fecha DESC LIMIT ?`,
      [idUsuario, limite]
    );
    return rows;
  }

  /**
   * Deuda total de los vecinos AL CIERRE de una fecha pasada: para cada vecino se toma el saldo_nuevo
   * de su último movimiento del cuaderno hasta ese día. Para HOY se usa el saldo real de Cliente
   * (ClienteRepository.totalDeuda), que es la fuente de verdad en vivo.
   */
  async deudaTotalAl(idUsuario, fecha) {
    const [[f]] = await pool.query(
      `SELECT COALESCE(SUM(u.saldo), 0) AS total, COUNT(*) AS deudores
         FROM (
           SELECT (SELECT m.saldo_nuevo FROM MovimientoFiado m
                    WHERE m.id_cliente = c.id_cliente
                      AND m.fecha_hora < DATE_ADD(?, INTERVAL 1 DAY)
                    ORDER BY m.fecha_hora DESC, m.id_movimiento DESC LIMIT 1) AS saldo
             FROM Cliente c WHERE c.id_usuario = ?
         ) u
        WHERE u.saldo > 0`,
      [fecha, idUsuario]
    );
    return f;
  }

  async conteoStock(idUsuario) {
    const [[f]] = await pool.query(
      `SELECT COALESCE(SUM(stock_actual <= 0), 0) AS agotados,
              COALESCE(SUM(stock_actual > 0 AND stock_actual <= stock_minimo), 0) AS por_agotarse
         FROM Producto WHERE id_usuario = ? AND estado <> 'Inactivo'`,
      [idUsuario]
    );
    return f;
  }
}

module.exports = new ReporteRepository();
