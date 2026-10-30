const { transaccion } = require('../config/db');
const ProductoRepository = require('../repositories/ProductoRepository');
const { noEncontrado, conflicto, solicitudInvalida } = require('../utils/errores');
const V = require('../utils/validaciones');
const cloudinary = require('cloudinary').v2;

// Configurar Cloudinary con las variables de entorno
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const ESTADOS = ['Disponible', 'Agotado', 'Inactivo'];
const NIVELES = ['verde', 'amarillo', 'rojo'];
const MAX_RAPIDOS = 30;

function validarImagen(v) {
  const t = V.texto(v, 'La imagen', { max: 255 });
  if (t !== null && !/^https?:\/\//i.test(t) && !t.startsWith('/')) {
    throw solicitudInvalida('La imagen debe ser un enlace (http/https) o una ruta del servidor.');
  }
  return t;
}

// Función auxiliar para subir el buffer de Multer a Cloudinary
function subirACloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'bazar_productos' },
      (error, result) => {
        if (result) resolve(result.secure_url);
        else reject(new Error('Error al subir la imagen a Cloudinary: ' + (error?.message || '')));
      }
    );
    stream.end(buffer);
  });
}

class ProductoService {
  async listar(idUsuario, q = {}) {
    const busqueda = V.texto(q.q, 'La búsqueda', { max: 100 });
    const lista = await ProductoRepository.listar(idUsuario, {
      q: busqueda,
      qEscapado: busqueda ? V.escaparLike(busqueda) : null,
      estado: V.vacio(q.estado) ? null : V.enumerado(q.estado, 'El estado', ESTADOS),
      incluirInactivos: !V.vacio(q.incluir_inactivos) && V.booleano(q.incluir_inactivos, 'incluir_inactivos'),
      nivel: V.vacio(q.nivel) ? null : V.enumerado(q.nivel, 'El nivel', NIVELES),
      soloFavoritos: !V.vacio(q.favoritos) && V.booleano(q.favoritos, 'favoritos'),
      ...V.paginacion(q, { limitePorDefecto: 50, limiteMax: 200 })
    });

    // Cargar las presentaciones para cada producto listado
    for (const p of lista) {
      p.presentaciones = await ProductoRepository.presentaciones(p.id_producto);
    }
    return lista;
  }

  async rapidos(idUsuario, q = {}) {
    const limite = V.vacio(q.limite) ? 15 : V.entero(q.limite, 'El límite', { min: 1, max: MAX_RAPIDOS });
    const lista = await ProductoRepository.rapidos(idUsuario, limite);
    
    // Cargar las presentaciones para cada producto rápido
    for (const p of lista) {
      p.presentaciones = await ProductoRepository.presentaciones(p.id_producto);
    }
    return lista;
  }

  alertas(idUsuario) {
    return ProductoRepository.alertas(idUsuario);
  }

  async obtener(idUsuario, id) {
    const p = await ProductoRepository.obtener(idUsuario, id);
    if (!p) throw noEncontrado('Producto no encontrado.');
    p.presentaciones = await ProductoRepository.presentaciones(id);
    return p;
  }

  async porCodigoBarras(idUsuario, codigo) {
    const c = V.texto(codigo, 'El código de barras', { obligatorio: true, max: 50 });
    const p = await ProductoRepository.obtenerPorCodigo(idUsuario, c);
    if (!p) throw noEncontrado('No tienes ningún producto con ese código de barras.');
    return p;
  }

  async crear(idUsuario, b = {}, file = null) {
    let imagenUrlFinal = validarImagen(b.imagen_url);

    // Si la tendera adjuntó un archivo desde su PC, lo subimos a Cloudinary
    if (file && file.buffer) {
      imagenUrlFinal = await subirACloudinary(file.buffer);
    }

    const datos = {
      nombre: V.texto(b.nombre, 'El nombre', { obligatorio: true, min: 2, max: 150 }),
      descripcion: V.texto(b.descripcion, 'La descripción', { max: 2000 }),
      codigo_barras: V.texto(b.codigo_barras, 'El código de barras', { max: 50 }),
      precio_venta: V.monto(b.precio_venta, 'El precio de venta', { obligatorio: true }),
      precio_costo: V.monto(b.precio_costo, 'El precio de costo') ?? 0,
      stock_actual: V.entero(b.stock_actual, 'El stock inicial', { min: 0 }) ?? 0,
      stock_minimo: V.entero(b.stock_minimo, 'El stock mínimo', { min: 0 }) ?? 5,
      unidad_medida: V.texto(b.unidad_medida, 'La unidad de medida', { max: 30 }) ?? 'unidad',
      es_favorito: V.vacio(b.es_favorito) ? false : V.booleano(b.es_favorito, 'es_favorito'),
      imagen_url: imagenUrlFinal
    };
    datos.estado = datos.stock_actual > 0 ? 'Disponible' : 'Agotado';

    if (datos.codigo_barras && (await ProductoRepository.existeCodigo(idUsuario, datos.codigo_barras))) {
      throw conflicto('Ya tienes un producto con ese código de barras.');
    }

    const id = await transaccion(async (conn) => {
      const nuevo = await ProductoRepository.crear(conn, idUsuario, datos);
      if (datos.stock_actual > 0) {
        await conn.query(
          `INSERT INTO MovimientoStock (id_usuario, id_producto, tipo, cantidad, stock_resultante, motivo)
           VALUES (?, ?, 'INICIAL', ?, ?, 'Stock inicial')`,
          [idUsuario, nuevo, datos.stock_actual, datos.stock_actual]
        );
      }
      return nuevo;
    });
    return this.obtener(idUsuario, id);
  }

  async actualizar(idUsuario, id, b = {}, file = null) {
    const actual = await ProductoRepository.obtener(idUsuario, id);
    if (!actual) throw noEncontrado('Producto no encontrado.');

    let imagenUrlFinal = b.imagen_url !== undefined ? validarImagen(b.imagen_url) : undefined;

    // Si se adjuntó un archivo nuevo al actualizar, subimos a Cloudinary
    if (file && file.buffer) {
      imagenUrlFinal = await subirACloudinary(file.buffer);
    }

    const c = {};
    if (b.nombre !== undefined) c.nombre = V.texto(b.nombre, 'El nombre', { obligatorio: true, min: 2, max: 150 });
    if (b.descripcion !== undefined) c.descripcion = V.texto(b.descripcion, 'La descripción', { max: 2000 });
    if (b.codigo_barras !== undefined) {
      c.codigo_barras = V.texto(b.codigo_barras, 'El código de barras', { max: 50 });
      if (c.codigo_barras && (await ProductoRepository.existeCodigo(idUsuario, c.codigo_barras, id))) {
        throw conflicto('Ya tienes otro producto con ese código de barras.');
      }
    }
    if (b.precio_venta !== undefined) c.precio_venta = V.monto(b.precio_venta, 'El precio de venta', { obligatorio: true });
    if (b.precio_costo !== undefined) c.precio_costo = V.monto(b.precio_costo, 'El precio de costo', { obligatorio: true });
    if (b.stock_minimo !== undefined) c.stock_minimo = V.entero(b.stock_minimo, 'El stock mínimo', { min: 0, obligatorio: true });
    if (b.unidad_medida !== undefined) c.unidad_medida = V.texto(b.unidad_medida, 'La unidad de medida', { obligatorio: true, max: 30 });
    if (b.es_favorito !== undefined) c.es_favorito = V.booleano(b.es_favorito, 'es_favorito') ? 1 : 0;
    if (imagenUrlFinal !== undefined) c.imagen_url = imagenUrlFinal;

    if (Object.keys(c).length === 0) throw solicitudInvalida('No enviaste ningún dato para actualizar.');
    await ProductoRepository.actualizar(idUsuario, id, c);
    return this.obtener(idUsuario, id);
  }

  async marcarFavorito(idUsuario, id, valor) {
    const p = await ProductoRepository.obtener(idUsuario, id);
    if (!p) throw noEncontrado('Producto no encontrado.');
    const nuevo = valor === undefined ? !p.es_favorito : V.booleano(valor, 'es_favorito');
    await ProductoRepository.actualizar(idUsuario, id, { es_favorito: nuevo ? 1 : 0 });
    return this.obtener(idUsuario, id);
  }

  async desactivar(idUsuario, id) {
    const p = await ProductoRepository.obtener(idUsuario, id);
    if (!p) throw noEncontrado('Producto no encontrado.');
    await ProductoRepository.actualizar(idUsuario, id, { estado: 'Inactivo', es_favorito: 0 });
  }

  async reactivar(idUsuario, id) {
    const p = await ProductoRepository.obtener(idUsuario, id);
    if (!p) throw noEncontrado('Producto no encontrado.');
    await ProductoRepository.actualizar(idUsuario, id, { estado: p.stock_actual > 0 ? 'Disponible' : 'Agotado' });
    return this.obtener(idUsuario, id);
  }

  async ajustarStock(idUsuario, id, b = {}) {
    const nuevoStock = V.entero(b.stock_nuevo, 'El stock real', { min: 0, obligatorio: true });
    const motivo = V.texto(b.motivo, 'El motivo', { max: 255 }) ?? 'Ajuste manual';

    await transaccion(async (conn) => {
      const mapa = await ProductoRepository.bloquear(conn, idUsuario, [id]);
      const p = mapa.get(id);
      if (!p) throw noEncontrado('Producto no encontrado.');
      const delta = nuevoStock - p.stock_actual;
      if (delta === 0) return;
      await ProductoRepository.moverStock(conn, { idUsuario, producto: p, delta, tipo: 'AJUSTE', motivo });
    });
    return this.obtener(idUsuario, id);
  }

  async movimientos(idUsuario, id, q = {}) {
    const p = await ProductoRepository.obtener(idUsuario, id);
    if (!p) throw noEncontrado('Producto no encontrado.');
    const limite = V.vacio(q.limite) ? 50 : V.entero(q.limite, 'El límite', { min: 1, max: 200 });
    return ProductoRepository.movimientos(idUsuario, id, limite);
  }

  async agregarPresentacion(idUsuario, id, b = {}) {
    const p = await ProductoRepository.obtener(idUsuario, id);
    if (!p) throw noEncontrado('Producto no encontrado.');
    const nombre = V.texto(b.nombre, 'El nombre de la presentación', { obligatorio: true, max: 50 });
    const unidades = V.entero(b.unidades, 'Las unidades', { min: 2, max: 10000, obligatorio: true });
    try {
      await ProductoRepository.crearPresentacion(id, nombre, unidades);
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') throw conflicto(`Ya existe la presentación "${nombre}" para este producto.`);
      throw e;
    }
    return ProductoRepository.presentaciones(id);
  }

  async quitarPresentacion(idUsuario, id, idPresentacion) {
    const p = await ProductoRepository.obtener(idUsuario, id);
    if (!p) throw noEncontrado('Producto no encontrado.');
    if (!(await ProductoRepository.eliminarPresentacion(id, idPresentacion))) {
      throw noEncontrado('Presentación no encontrada.');
    }
  }
}

module.exports = new ProductoService();