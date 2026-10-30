const pool = require('../config/db');

// Semáforo del inventario: rojo = agotado, amarillo = quedan pocos, verde = hay stock.
const NIVEL_STOCK = `CASE WHEN p.stock_actual <= 0 THEN 'rojo'
                         WHEN p.stock_actual <= p.stock_minimo THEN 'amarillo'
                         ELSE 'verde' END`;

const CAMPOS = `p.id_producto, p.nombre, p.descripcion, p.codigo_barras, p.precio_costo, p.precio_venta,
                p.stock_actual, p.stock_minimo, p.unidad_medida, p.estado, p.es_favorito, p.imagen_url,
                ${NIVEL_STOCK} AS nivel_stock`;

const mapear = (r) => (r ? { ...r, es_favorito: !!r.es_favorito } : r);

class ProductoRepository {
  /**
   * @param {object} f { q, estado, incluirInactivos, nivel, soloFavoritos, limite, desplazamiento }
   */
  async listar(idUsuario, f) {
    const where = ['p.id_usuario = ?'];
    const params = [idUsuario];

    if (f.estado) { where.push('p.estado = ?'); params.push(f.estado); }
    else if (!f.incluirInactivos) where.push(`p.estado <> 'Inactivo'`);

    if (f.nivel) where.push(`${NIVEL_STOCK} = ?`), params.push(f.nivel);
    if (f.soloFavoritos) where.push('p.es_favorito = 1');

    let orden = 'p.nombre ASC';
    if (f.q) {
      where.push(`(p.nombre LIKE ? OR p.codigo_barras = ?)`);
      params.push(`%${f.qEscapado}%`, f.q);
      orden = `(p.nombre LIKE ?) DESC, p.nombre ASC`;
    }
    const paramsOrden = f.q ? [`${f.qEscapado}%`] : [];

    const [rows] = await pool.query(
      `SELECT ${CAMPOS} FROM Producto p
       WHERE ${where.join(' AND ')}
       ORDER BY ${orden}
       LIMIT ? OFFSET ?`,
      [...params, ...paramsOrden, f.limite, f.desplazamiento]
    );

    const productos = rows.map(mapear);
    for (const p of productos) {
      p.presentaciones = await this.presentaciones(p.id_producto);
    }
    return productos;
  }

  async obtener(idUsuario, idProducto, conn = pool) {
    const [rows] = await conn.query(
      `SELECT ${CAMPOS} FROM Producto p WHERE p.id_producto = ? AND p.id_usuario = ?`,
      [idProducto, idUsuario]
    );
    return mapear(rows[0]) || null;
  }

  async obtenerPorCodigo(idUsuario, codigo) {
    const [rows] = await pool.query(
      `SELECT ${CAMPOS} FROM Producto p WHERE p.codigo_barras = ? AND p.id_usuario = ?`,
      [codigo, idUsuario]
    );
    return mapear(rows[0]) || null;
  }

  /**
   * Pantalla "Un Toque": primero los favoritos fijados por la dueña y luego, hasta
   * completar el cupo, lo más vendido en los últimos 30 días. Sin configurar nada.
   */
async rapidos(idUsuario, limite) {
    const [rows] = await pool.query(
      `SELECT ${CAMPOS},
              IF(p.es_favorito = 1, 'fijado', 'mas_vendido') AS origen
         FROM Producto p
         LEFT JOIN (
              SELECT dv.id_producto, SUM(dv.cantidad) AS vendidas
                FROM DetalleVenta dv
                JOIN Venta v ON v.id_venta = dv.id_venta
               WHERE v.id_usuario = ? AND v.estado_venta = 'Completada'
                 AND v.fecha_hora >= DATE_SUB(NOW(), INTERVAL 30 DAY)
               GROUP BY dv.id_producto
         ) t ON t.id_producto = p.id_producto
        WHERE p.id_usuario = ? AND p.estado = 'Disponible' AND p.stock_actual > 0
          AND (p.es_favorito = 1 OR t.vendidas IS NOT NULL)
        ORDER BY p.es_favorito DESC, COALESCE(t.vendidas, 0) DESC, p.nombre ASC
        LIMIT ?`,
      [idUsuario, idUsuario, limite]
    );

    const productos = rows.map(mapear);
    for (const p of productos) {
      p.presentaciones = await this.presentaciones(p.id_producto);
    }
    return productos;
  }

  /** Productos agotados y por agotarse. Incluye los 'Agotado' (la vista vw_StockCritico los omitía). */
  async alertas(idUsuario) {
    const [rows] = await pool.query(
      `SELECT ${CAMPOS} FROM Producto p
        WHERE p.id_usuario = ? AND p.estado <> 'Inactivo' AND p.stock_actual <= p.stock_minimo
        ORDER BY p.stock_actual ASC, p.nombre ASC`,
      [idUsuario]
    );
    return rows.map(mapear);
  }

  async existeCodigo(idUsuario, codigo, exceptoId = null) {
    const [rows] = await pool.query(
      `SELECT id_producto FROM Producto WHERE id_usuario = ? AND codigo_barras = ? ${exceptoId ? 'AND id_producto <> ?' : ''}`,
      exceptoId ? [idUsuario, codigo, exceptoId] : [idUsuario, codigo]
    );
    return rows.length > 0;
  }

  async crear(conn, idUsuario, d) {
    const [r] = await conn.query(
      `INSERT INTO Producto (id_usuario, nombre, descripcion, codigo_barras, precio_costo, precio_venta,
                             stock_actual, stock_minimo, unidad_medida, estado, es_favorito, imagen_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [idUsuario, d.nombre, d.descripcion, d.codigo_barras, d.precio_costo, d.precio_venta,
       d.stock_actual, d.stock_minimo, d.unidad_medida, d.estado, d.es_favorito ? 1 : 0, d.imagen_url]
    );
    return r.insertId;
  }

  async actualizar(idUsuario, idProducto, campos) {
    const sets = Object.keys(campos).map((c) => `${c} = ?`).join(', ');
    await pool.query(
      `UPDATE Producto SET ${sets} WHERE id_producto = ? AND id_usuario = ?`,
      [...Object.values(campos), idProducto, idUsuario]
    );
  }

  /** Bloquea las filas (FOR UPDATE) en orden de id: evita deadlocks entre ventas simultáneas. */
  async bloquear(conn, idUsuario, ids) {
    if (ids.length === 0) return new Map();
    const ordenados = [...new Set(ids)].sort((a, b) => a - b);
    const [rows] = await conn.query(
      `SELECT id_producto, nombre, precio_costo, precio_venta, stock_actual, estado
         FROM Producto
        WHERE id_usuario = ? AND id_producto IN (?)
        ORDER BY id_producto
          FOR UPDATE`,
      [idUsuario, ordenados]
    );
    return new Map(rows.map((r) => [r.id_producto, r]));
  }

  /**
   * ÚNICO punto por el que cambia el stock: actualiza Producto, recalcula su estado
   * (Disponible/Agotado; un Inactivo sigue Inactivo) y deja huella en MovimientoStock.
   * Debe llamarse con la fila ya bloqueada con bloquear().
   */
  async moverStock(conn, { idUsuario, producto, delta, tipo, idReferencia = null, motivo = null }) {
    const nuevo = producto.stock_actual + delta;
    const estado = producto.estado === 'Inactivo' ? 'Inactivo' : nuevo > 0 ? 'Disponible' : 'Agotado';
    await conn.query(
      `UPDATE Producto SET stock_actual = ?, estado = ? WHERE id_producto = ? AND id_usuario = ?`,
      [nuevo, estado, producto.id_producto, idUsuario]
    );
    await conn.query(
      `INSERT INTO MovimientoStock (id_usuario, id_producto, tipo, cantidad, stock_resultante, id_referencia, motivo)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [idUsuario, producto.id_producto, tipo, delta, nuevo, idReferencia, motivo]
    );
    producto.stock_actual = nuevo;
    producto.estado = estado;
    return nuevo;
  }

  async movimientos(idUsuario, idProducto, limite) {
    const [rows] = await pool.query(
      `SELECT id_movimiento, tipo, cantidad, stock_resultante, id_referencia, motivo, fecha_hora
         FROM MovimientoStock WHERE id_usuario = ? AND id_producto = ?
        ORDER BY id_movimiento DESC LIMIT ?`,
      [idUsuario, idProducto, limite]
    );
    return rows;
  }

  // ---- Presentaciones ----
  async presentaciones(idProducto) {
    const [rows] = await pool.query(
      `SELECT id_presentacion, nombre, unidades FROM PresentacionProducto WHERE id_producto = ? ORDER BY unidades`,
      [idProducto]
    );
    return rows;
  }
  async crearPresentacion(idProducto, nombre, unidades) {
    const [r] = await pool.query(
      `INSERT INTO PresentacionProducto (id_producto, nombre, unidades) VALUES (?, ?, ?)`,
      [idProducto, nombre, unidades]
    );
    return r.insertId;
  }
  async eliminarPresentacion(idProducto, idPresentacion) {
    const [r] = await pool.query(
      `DELETE FROM PresentacionProducto WHERE id_presentacion = ? AND id_producto = ?`,
      [idPresentacion, idProducto]
    );
    return r.affectedRows > 0;
  }
}

module.exports = new ProductoRepository();
