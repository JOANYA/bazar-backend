const pool = require('../config/db');

class CompraRepository {
  async insertar(conn, { idUsuario, proveedor, observaciones, totalCosto }) {
    const [r] = await conn.query(
      `INSERT INTO Compra (id_usuario, proveedor, total_costo, observaciones) VALUES (?, ?, ?, ?)`,
      [idUsuario, proveedor, totalCosto, observaciones]
    );
    return r.insertId;
  }

  async insertarDetalles(conn, idCompra, filas) {
    await conn.query(
      `INSERT INTO DetalleCompra (id_compra, id_producto, id_presentacion, cantidad_comprada, unidades_ingresadas, costo_unitario, costo_total)
       VALUES ?`,
      [filas.map((f) => [idCompra, f.idProducto, f.idPresentacion, f.cantidad, f.unidades, f.costoUnitario, f.costoTotal])]
    );
  }

  async presentaciones(conn, idsProducto) {
    if (idsProducto.length === 0) return new Map();
    const [rows] = await conn.query(
      `SELECT id_presentacion, id_producto, nombre, unidades FROM PresentacionProducto WHERE id_producto IN (?)`,
      [idsProducto]
    );
    return new Map(rows.map((r) => [r.id_presentacion, r]));
  }

  async actualizarPrecios(conn, idUsuario, idProducto, campos) {
    const sets = Object.keys(campos).map((c) => `${c} = ?`).join(', ');
    await conn.query(`UPDATE Producto SET ${sets} WHERE id_producto = ? AND id_usuario = ?`, [...Object.values(campos), idProducto, idUsuario]);
  }

  async obtenerCompleta(idUsuario, idCompra) {
    const [[c]] = await pool.query(
      `SELECT id_compra, proveedor, fecha_hora, total_costo, observaciones FROM Compra WHERE id_compra = ? AND id_usuario = ?`,
      [idCompra, idUsuario]
    );
    if (!c) return null;
    const [items] = await pool.query(
      `SELECT dc.id_producto, p.nombre, pr.nombre AS presentacion, dc.cantidad_comprada, dc.unidades_ingresadas,
              dc.costo_unitario, dc.costo_total
         FROM DetalleCompra dc
         JOIN Producto p ON p.id_producto = dc.id_producto
         LEFT JOIN PresentacionProducto pr ON pr.id_presentacion = dc.id_presentacion
        WHERE dc.id_compra = ? ORDER BY p.nombre, dc.id_detalle`,
      [idCompra]
    );
    return { ...c, items };
  }

  async listar(idUsuario, { desde, hasta, limite, desplazamiento }) {
    const [rows] = await pool.query(
      `SELECT c.id_compra, c.proveedor, c.fecha_hora, c.total_costo, c.observaciones,
              (SELECT COUNT(*) FROM DetalleCompra WHERE id_compra = c.id_compra) AS lineas
         FROM Compra c
        WHERE c.id_usuario = ? AND c.fecha_hora >= ? AND c.fecha_hora < DATE_ADD(?, INTERVAL 1 DAY)
        ORDER BY c.fecha_hora DESC, c.id_compra DESC LIMIT ? OFFSET ?`,
      [idUsuario, desde, hasta, limite, desplazamiento]
    );
    return rows;
  }
}

module.exports = new CompraRepository();
