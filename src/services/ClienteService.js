const { transaccion } = require('../config/db');
const ClienteRepository = require('../repositories/ClienteRepository');
const { noEncontrado, conflicto, solicitudInvalida } = require('../utils/errores');
const { aCentimos } = require('../utils/dinero');
const V = require('../utils/validaciones');

const METODOS_COBRO = ['Efectivo', 'Yape', 'Plin', 'Tarjeta'];

function validarTelefono(v) {
  const t = V.texto(v, 'El teléfono', { max: 20 });
  if (t === null) return null;
  const limpio = t.replace(/[\s-]/g, '');
  if (!/^\+?\d{6,15}$/.test(limpio)) throw solicitudInvalida('El teléfono debe tener entre 6 y 15 dígitos.');
  return limpio;
}

class ClienteService {
  listar(idUsuario, q = {}) {
    const busqueda = V.texto(q.q, 'La búsqueda', { max: 100 });
    return ClienteRepository.listar(idUsuario, {
      q: busqueda,
      qEscapado: busqueda ? V.escaparLike(busqueda) : null,
      conDeuda: !V.vacio(q.con_deuda) && V.booleano(q.con_deuda, 'con_deuda'),
      ...V.paginacion(q, { limitePorDefecto: 50, limiteMax: 200 })
    });
  }

  /**
   * Alta rápida: solo el nombre es obligatorio (Fiado Express: nada de DNI ni correo en el mostrador).
   * limite_credito 0 significa "sin límite".
   */
  async crear(idUsuario, b = {}) {
    const id = await ClienteRepository.crear(idUsuario, {
      nombre: V.texto(b.nombre, 'El nombre', { obligatorio: true, min: 2, max: 150 }),
      telefono: validarTelefono(b.telefono),
      direccion: V.texto(b.direccion, 'La dirección', { max: 200 }),
      limite_credito: V.monto(b.limite_credito, 'El límite de crédito') ?? 0
    });
    return ClienteRepository.obtener(idUsuario, id);
  }

  async actualizar(idUsuario, id, b = {}) {
    if (!(await ClienteRepository.obtener(idUsuario, id))) throw noEncontrado('Cliente no encontrado.');
    const c = {};
    if (b.nombre !== undefined) c.nombre = V.texto(b.nombre, 'El nombre', { obligatorio: true, min: 2, max: 150 });
    if (b.telefono !== undefined) c.telefono = validarTelefono(b.telefono);
    if (b.direccion !== undefined) c.direccion = V.texto(b.direccion, 'La dirección', { max: 200 });
    if (b.limite_credito !== undefined) c.limite_credito = V.monto(b.limite_credito, 'El límite de crédito', { obligatorio: true });
    if (Object.keys(c).length === 0) throw solicitudInvalida('No enviaste ningún dato para actualizar.');
    await ClienteRepository.actualizar(idUsuario, id, c);
    return ClienteRepository.obtener(idUsuario, id);
  }

  /** Ficha del vecino: datos + historial de deudas y pagos. */
  async detalle(idUsuario, id, q = {}) {
    const cliente = await ClienteRepository.obtener(idUsuario, id);
    if (!cliente) throw noEncontrado('Cliente no encontrado.');
    const limite = V.vacio(q.limite) ? 50 : V.entero(q.limite, 'El límite', { min: 1, max: 200 });
    cliente.movimientos = await ClienteRepository.movimientos(id, limite);
    return cliente;
  }

  /** El vecino abona a su cuenta. No se aceptan abonos mayores a lo que debe. */
  async registrarPago(idUsuario, id, b = {}) {
    const monto = V.monto(b.monto, 'El monto', { obligatorio: true, min: 0.01 });
    const metodo = V.enumerado(b.metodo_pago, 'El método de pago', METODOS_COBRO, { porDefecto: 'Efectivo' });
    const observacion = V.texto(b.observacion, 'La observación', { max: 255 });

    return transaccion(async (conn) => {
      const cliente = await ClienteRepository.bloquear(conn, idUsuario, id);
      if (!cliente) throw noEncontrado('Cliente no encontrado.');
      if (cliente.saldo_deudor <= 0) throw conflicto(`${cliente.nombre} no tiene deuda pendiente.`);
      if (aCentimos(monto) > aCentimos(cliente.saldo_deudor)) {
        throw conflicto(`${cliente.nombre} debe S/ ${cliente.saldo_deudor.toFixed(2)}; no puedes cobrar S/ ${monto.toFixed(2)}.`);
      }
      const saldo = await ClienteRepository.registrarMovimiento(conn, {
        cliente, tipo: 'PAGO', montoCentimos: aCentimos(monto), metodoPago: metodo, observacion
      });
      return { id_cliente: id, nombre: cliente.nombre, monto_pagado: monto, metodo_pago: metodo, saldo_deudor: saldo };
    });
  }
}

module.exports = new ClienteService();
