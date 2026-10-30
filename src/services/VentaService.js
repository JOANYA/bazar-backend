const pool = require('../config/db');
const { transaccion, fechaHoy } = require('../config/db');
const VentaRepository = require('../repositories/VentaRepository');
const ProductoRepository = require('../repositories/ProductoRepository');
const ClienteRepository = require('../repositories/ClienteRepository');
const { noEncontrado, conflicto, solicitudInvalida } = require('../utils/errores');
const { aCentimos, aSoles } = require('../utils/dinero');
const V = require('../utils/validaciones');

const METODOS_PAGO = ['Efectivo', 'Yape', 'Plin', 'Fiado', 'Tarjeta'];
const MAX_ITEMS = 100;
const MAX_CANTIDAD = 9999;
const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valida el ticket y junta repetidos (el mismo producto tocado dos veces suma cantidad). */
function validarVenta(body = {}) {
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw solicitudInvalida('El carrito está vacío: agrega al menos un producto.');
  }
  if (body.items.length > MAX_ITEMS) throw solicitudInvalida(`Demasiados productos en una sola venta (máximo ${MAX_ITEMS}).`);

  const acumulado = new Map();
  body.items.forEach((it, i) => {
    const n = i + 1;
    const idProducto = V.entero(it?.id_producto, `El id del producto #${n}`, { min: 1, obligatorio: true });
    const cantidad = V.entero(it?.cantidad, `La cantidad del producto #${n}`, { min: 1, max: MAX_CANTIDAD, obligatorio: true });
    const total = (acumulado.get(idProducto) || 0) + cantidad;
    if (total > MAX_CANTIDAD) throw solicitudInvalida(`La cantidad del producto #${n} supera el máximo permitido (${MAX_CANTIDAD}).`);
    acumulado.set(idProducto, total);
  });

  const metodoPago = V.enumerado(body.metodo_pago, 'El método de pago', METODOS_PAGO, { porDefecto: 'Efectivo' });
  const idCliente = V.entero(body.id_cliente, 'El cliente', { min: 1 });
  if (metodoPago === 'Fiado' && !idCliente) throw solicitudInvalida('Para fiar tienes que elegir a qué vecino.');

  let uuid = null;
  if (!V.vacio(body.uuid_cliente)) {
    uuid = String(body.uuid_cliente).trim().toLowerCase();
    if (!REGEX_UUID.test(uuid)) throw solicitudInvalida('uuid_cliente debe ser un UUID válido.');
  }

  return {
    items: [...acumulado].map(([idProducto, cantidad]) => ({ idProducto, cantidad })),
    metodoPago,
    idCliente,
    observaciones: V.texto(body.observaciones, 'Las observaciones', { max: 500 }),
    uuid
  };
}

class VentaService {
  /**
   * Registra una venta COMPLETA en una sola transacción: ticket, ítems, descuento de stock
   * y (si es fiado) la deuda del vecino. O pasa todo o no pasa nada.
   * Devuelve { venta, repetida }.
   */
  async registrar(idUsuario, body) {
    const d = validarVenta(body);

    // Reintento de la PWA (se cayó el internet y reenvió): devolvemos la venta original.
    if (d.uuid) {
      const previa = await VentaRepository.buscarPorUuid(pool, idUsuario, d.uuid);
      if (previa) return { venta: await VentaRepository.obtenerCompleta(idUsuario, previa.id_venta), repetida: true };
    }

    let idVenta;
    try {
      idVenta = await transaccion((conn) => this.#registrarTx(conn, idUsuario, d));
    } catch (e) {
      // Dos envíos simultáneos del mismo uuid: el segundo choca con el índice único.
      if (e.code === 'ER_DUP_ENTRY' && d.uuid) {
        const previa = await VentaRepository.buscarPorUuid(pool, idUsuario, d.uuid);
        if (previa) return { venta: await VentaRepository.obtenerCompleta(idUsuario, previa.id_venta), repetida: true };
      }
      throw e;
    }
    return { venta: await VentaRepository.obtenerCompleta(idUsuario, idVenta), repetida: false };
  }

  async #registrarTx(conn, idUsuario, d) {
    const productos = await ProductoRepository.bloquear(conn, idUsuario, d.items.map((i) => i.idProducto));

    let totalCent = 0;
    const lineas = [];
    for (const it of d.items) {
      const p = productos.get(it.idProducto);
      if (!p) throw noEncontrado(`El producto #${it.idProducto} no existe en tu bazar.`);
      if (p.estado === 'Inactivo') throw conflicto(`"${p.nombre}" está desactivado y no se puede vender.`);
      if (p.stock_actual < it.cantidad) {
        throw conflicto(
          p.stock_actual <= 0
            ? `"${p.nombre}" está agotado.`
            : `Stock insuficiente de "${p.nombre}": solo quedan ${p.stock_actual}.`
        );
      }
      // El precio SIEMPRE sale de la base, nunca del cliente HTTP.
      totalCent += aCentimos(p.precio_venta) * it.cantidad;
      lineas.push({ idProducto: p.id_producto, cantidad: it.cantidad, precio: p.precio_venta, costo: p.precio_costo, producto: p });
    }

    let cliente = null;
    if (d.metodoPago === 'Fiado') {
      cliente = await ClienteRepository.bloquear(conn, idUsuario, d.idCliente);
      if (!cliente) throw noEncontrado('Ese vecino no está registrado en tu bazar.');
      const limite = aCentimos(cliente.limite_credito);
      const nuevaDeuda = aCentimos(cliente.saldo_deudor) + totalCent;
      // limite_credito = 0 significa "sin límite" (así no se frena el fiado de un vecino recién anotado)
      if (limite > 0 && nuevaDeuda > limite) {
        throw conflicto(
          `${cliente.nombre} pasaría su límite de fiado (S/ ${aSoles(limite).toFixed(2)}): ` +
          `ya debe S/ ${cliente.saldo_deudor.toFixed(2)} y esta venta es de S/ ${aSoles(totalCent).toFixed(2)}.`
        );
      }
    } else if (d.idCliente && !(await ClienteRepository.obtener(idUsuario, d.idCliente, conn))) {
      throw noEncontrado('Ese vecino no está registrado en tu bazar.');
    }

    const idVenta = await VentaRepository.insertar(conn, {
      idUsuario, idCliente: d.idCliente, montoTotal: aSoles(totalCent),
      metodoPago: d.metodoPago, observaciones: d.observaciones, uuid: d.uuid
    });
    await VentaRepository.insertarDetalles(conn, idVenta, lineas);

    for (const l of lineas) {
      await ProductoRepository.moverStock(conn, {
        idUsuario, producto: l.producto, delta: -l.cantidad, tipo: 'VENTA', idReferencia: idVenta
      });
    }

    if (cliente) {
      await ClienteRepository.registrarMovimiento(conn, {
        cliente, idVenta, tipo: 'DEUDA', montoCentimos: totalCent, observacion: `Venta #${idVenta}`
      });
    }
    return idVenta;
  }

  /** Deshace una venta: devuelve el stock y, si fue fiada, descuenta la deuda. */
  async anular(idUsuario, idVenta, b = {}) {
    const motivo = V.texto(b.motivo, 'El motivo', { max: 200 }) ?? 'Sin motivo indicado';

    await transaccion(async (conn) => {
      const venta = await VentaRepository.bloquear(conn, idUsuario, idVenta);
      if (!venta) throw noEncontrado('Venta no encontrada.');
      if (venta.estado_venta === 'Anulada') throw conflicto('Esta venta ya estaba anulada.');

      const detalles = await VentaRepository.detallesBasicos(conn, idVenta);
      const productos = await ProductoRepository.bloquear(conn, idUsuario, detalles.map((d) => d.id_producto));
      for (const det of detalles) {
        await ProductoRepository.moverStock(conn, {
          idUsuario, producto: productos.get(det.id_producto), delta: det.cantidad,
          tipo: 'ANULACION', idReferencia: idVenta, motivo
        });
      }

      if (venta.metodo_pago === 'Fiado' && venta.id_cliente) {
        const cliente = await ClienteRepository.bloquear(conn, idUsuario, venta.id_cliente);
        if (cliente) {
          // metodo_pago NULL: es un reverso contable, no dinero que entró (no cuenta en el cierre de caja)
          await ClienteRepository.registrarMovimiento(conn, {
            cliente, idVenta, tipo: 'PAGO', montoCentimos: aCentimos(venta.monto_total),
            metodoPago: null, observacion: `Anulación de la venta #${idVenta}`
          });
        }
      }
      await VentaRepository.marcarAnulada(conn, idVenta, motivo);
    });

    return VentaRepository.obtenerCompleta(idUsuario, idVenta);
  }

  async obtener(idUsuario, id) {
    const v = await VentaRepository.obtenerCompleta(idUsuario, id);
    if (!v) throw noEncontrado('Venta no encontrada.');
    return v;
  }

  async listar(idUsuario, q = {}) {
    const hoy = await fechaHoy();
    let desde; let hasta;
    if (!V.vacio(q.fecha)) {
      desde = hasta = V.fecha(q.fecha);
    } else {
      desde = V.vacio(q.desde) ? hoy : V.fecha(q.desde, 'La fecha desde');
      hasta = V.vacio(q.hasta) ? hoy : V.fecha(q.hasta, 'La fecha hasta');
    }
    if (desde > hasta) throw solicitudInvalida('La fecha "desde" no puede ser posterior a "hasta".');

    return VentaRepository.listar(idUsuario, {
      desde, hasta,
      metodo: V.vacio(q.metodo_pago) ? null : V.enumerado(q.metodo_pago, 'El método de pago', METODOS_PAGO),
      estado: V.vacio(q.estado) ? null : V.enumerado(q.estado, 'El estado', ['Completada', 'Anulada']),
      ...V.paginacion(q, { limitePorDefecto: 100, limiteMax: 500 })
    });
  }
}

module.exports = new VentaService();
module.exports.validarVenta = validarVenta;
