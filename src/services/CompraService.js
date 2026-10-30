const { transaccion, fechaHoy } = require('../config/db');
const CompraRepository = require('../repositories/CompraRepository');
const ProductoRepository = require('../repositories/ProductoRepository');
const { noEncontrado, conflicto, solicitudInvalida } = require('../utils/errores');
const { aCentimos, aSoles } = require('../utils/dinero');
const { sumarDias } = require('../utils/fechas');
const V = require('../utils/validaciones');

const MAX_ITEMS = 100;

function validarCompra(body = {}) {
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw solicitudInvalida('Agrega al menos un producto a la compra.');
  }
  if (body.items.length > MAX_ITEMS) throw solicitudInvalida(`Demasiados productos en una compra (máximo ${MAX_ITEMS}).`);

  return {
    proveedor: V.texto(body.proveedor, 'El proveedor', { max: 150 }),
    observaciones: V.texto(body.observaciones, 'Las observaciones', { max: 255 }),
    items: body.items.map((it, i) => {
      const n = i + 1;
      return {
        idProducto: V.entero(it?.id_producto, `El id del producto #${n}`, { min: 1, obligatorio: true }),
        cantidad: V.entero(it?.cantidad, `La cantidad del producto #${n}`, { min: 1, max: 99999, obligatorio: true }),
        idPresentacion: V.entero(it?.id_presentacion, `La presentación del producto #${n}`, { min: 1 }),
        // costo = lo que costó CADA presentación comprada (la caja, o la unidad si no hay presentación)
        costo: V.monto(it?.costo, `El costo del producto #${n}`),
        precioVenta: V.monto(it?.precio_venta, `El precio de venta del producto #${n}`)
      };
    })
  };
}

class CompraService {
  /**
   * "Carga Rápida de Factura": por cada producto, cuánto llegó (en cajas o unidades),
   * a cuánto costó y, si quiere, el nuevo precio de venta. Todo en una transacción.
   */
  async registrar(idUsuario, body) {
    const d = validarCompra(body);

    const idCompra = await transaccion(async (conn) => {
      const productos = await ProductoRepository.bloquear(conn, idUsuario, d.items.map((i) => i.idProducto));
      const presentaciones = await CompraRepository.presentaciones(conn, [...productos.keys()]);

      // 1ª pasada: validar y calcular, sin escribir nada
      let totalCent = 0;
      const lineas = d.items.map((it) => {
        const p = productos.get(it.idProducto);
        if (!p) throw noEncontrado(`El producto #${it.idProducto} no existe en tu bazar.`);
        if (p.estado === 'Inactivo') throw conflicto(`"${p.nombre}" está desactivado. Reactívalo antes de ingresar mercadería.`);

        let factor = 1;
        if (it.idPresentacion) {
          const pres = presentaciones.get(it.idPresentacion);
          if (!pres || pres.id_producto !== p.id_producto) {
            throw solicitudInvalida(`La presentación indicada no pertenece a "${p.nombre}".`);
          }
          factor = pres.unidades;
        }
        const unidades = it.cantidad * factor;

        let costoTotalCent;
        let costoUnitCent;
        if (it.costo !== null) {
          costoTotalCent = aCentimos(it.costo) * it.cantidad;
          costoUnitCent = Math.round(costoTotalCent / unidades);
        } else {
          costoUnitCent = aCentimos(p.precio_costo); // no informó costo: se mantiene el actual
          costoTotalCent = costoUnitCent * unidades;
        }
        totalCent += costoTotalCent;
        return { it, p, unidades, costoUnitCent, costoTotalCent };
      });

      const idNueva = await CompraRepository.insertar(conn, {
        idUsuario, proveedor: d.proveedor, observaciones: d.observaciones, totalCosto: aSoles(totalCent)
      });
      await CompraRepository.insertarDetalles(conn, idNueva, lineas.map((l) => ({
        idProducto: l.p.id_producto, idPresentacion: l.it.idPresentacion, cantidad: l.it.cantidad,
        unidades: l.unidades, costoUnitario: aSoles(l.costoUnitCent), costoTotal: aSoles(l.costoTotalCent)
      })));

      // 2ª pasada: stock y precios
      for (const l of lineas) {
        const precios = {};
        if (l.it.costo !== null) precios.precio_costo = aSoles(l.costoUnitCent);
        if (l.it.precioVenta !== null) precios.precio_venta = l.it.precioVenta;
        if (Object.keys(precios).length) {
          await CompraRepository.actualizarPrecios(conn, idUsuario, l.p.id_producto, precios);
          Object.assign(l.p, precios);
        }
        await ProductoRepository.moverStock(conn, {
          idUsuario, producto: l.p, delta: l.unidades, tipo: 'COMPRA', idReferencia: idNueva,
          motivo: d.proveedor ? `Compra a ${d.proveedor}` : null
        });
      }
      return idNueva;
    });

    return CompraRepository.obtenerCompleta(idUsuario, idCompra);
  }

  async obtener(idUsuario, id) {
    const c = await CompraRepository.obtenerCompleta(idUsuario, id);
    if (!c) throw noEncontrado('Compra no encontrada.');
    return c;
  }

  async listar(idUsuario, q = {}) {
    const hoy = await fechaHoy();
    const hasta = V.vacio(q.hasta) ? hoy : V.fecha(q.hasta, 'La fecha hasta');
    const desde = V.vacio(q.desde) ? sumarDias(hasta, -30) : V.fecha(q.desde, 'La fecha desde');
    if (desde > hasta) throw solicitudInvalida('La fecha "desde" no puede ser posterior a "hasta".');
    return CompraRepository.listar(idUsuario, { desde, hasta, ...V.paginacion(q, { limitePorDefecto: 50, limiteMax: 200 }) });
  }
}

module.exports = new CompraService();
