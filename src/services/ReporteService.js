const { fechaHoy } = require('../config/db');
const ReporteRepository = require('../repositories/ReporteRepository');
const ClienteRepository = require('../repositories/ClienteRepository');
const { solicitudInvalida } = require('../utils/errores');
const { redondear } = require('../utils/dinero');
const V = require('../utils/validaciones');

const suma = (...n) => redondear(n.reduce((a, b) => a + (Number(b) || 0), 0));

class ReporteService {
  async #fechaDe(valor) {
    const hoy = await fechaHoy();
    return { hoy, fecha: V.vacio(valor) ? hoy : V.fecha(valor) };
  }

  /**
   * El "cierre visual": lo que la dueña ve a las 10 de la noche. Se calcula en vivo
   * desde las ventas; si el día ya se cerró, se indica con `cerrado` y `cierre_hora`.
   */
  async dia(idUsuario, fechaParam) {
    const { fecha } = await this.#fechaDe(fechaParam);
    const { hoy } = await this.#fechaDe(undefined);
    const [ventasRows, cobrosRows, productos, cierre, deuda] = await Promise.all([
      ReporteRepository.ventasPorMetodo(idUsuario, fecha),
      ReporteRepository.cobrosPorMetodo(idUsuario, fecha),
      ReporteRepository.productosDelDia(idUsuario, fecha),
      ReporteRepository.cierreDelDia(idUsuario, fecha),
      // Hoy: saldo real de cada cuenta. Día pasado: lo que debían al terminar ese día.
      fecha === hoy ? ClienteRepository.totalDeuda(idUsuario) : ReporteRepository.deudaTotalAl(idUsuario, fecha)
    ]);

    const v = Object.fromEntries(ventasRows.map((r) => [r.metodo_pago, r]));
    const c = Object.fromEntries(cobrosRows.map((r) => [r.metodo_pago, r.total]));

    const ventas = {
      efectivo: redondear(v['Efectivo']?.total ?? 0),
      yape: redondear(v['Yape']?.total ?? 0),
      plin: redondear(v['Plin']?.total ?? 0),
      tarjeta: redondear(v['Tarjeta']?.total ?? 0),
      fiado: redondear(v['Fiado']?.total ?? 0)
    };
    const cobrosDeuda = {
      efectivo: redondear(c['Efectivo'] ?? 0),
      yape: redondear(c['Yape'] ?? 0),
      plin: redondear(c['Plin'] ?? 0),
      tarjeta: redondear(c['Tarjeta'] ?? 0),
      digital: suma(c['Yape'], c['Plin'], c['Tarjeta'])
    };
    cobrosDeuda.total = suma(cobrosDeuda.efectivo, cobrosDeuda.digital);

    const top = productos.map((p) => ({
      id_producto: p.id_producto, nombre: p.nombre, unidades: p.unidades,
      ingresos: redondear(p.ingresos), ganancia: redondear(p.ganancia)
    }));

    return {
      fecha,
      cerrado: !!cierre,
      cierre_hora: cierre ? cierre.fecha_hora_cierre : null,
      num_ventas: ventasRows.reduce((a, r) => a + r.n, 0),
      // TOTAL VENDIDO: mercadería vendida ese día, al contado y al crédito.
      total_vendido: suma(ventas.efectivo, ventas.yape, ventas.plin, ventas.tarjeta, ventas.fiado),
      ventas,
      cobros_deuda: cobrosDeuda,
      // RECAUDACIÓN: dinero que realmente entró = ventas al contado + deudas cobradas. El fiado NO entra.
      recaudacion: suma(ventas.efectivo, ventas.yape, ventas.plin, ventas.tarjeta, cobrosDeuda.total),      // FIADO GENERADO: crédito otorgado en las ventas de ese día. Los abonos NO se le restan:
      // son dinero recuperado de deudas (se muestran aparte) y no están ligados a una venta concreta.
      fiado_generado: ventas.fiado,
      // COBRANZA DE DEUDAS: abonos recibidos ese día (normalmente de fiados de días anteriores).
      cobranza_deudas: cobrosDeuda.total,
      // DEUDA TOTAL PENDIENTE: suma de los saldos reales de todas las cuentas de vecinos.
      deuda_total_pendiente: { total: redondear(deuda.total), vecinos: deuda.deudores },
      // Lo que debe haber físicamente en la gaveta: ventas al contado en efectivo + abonos de deudas en efectivo
      efectivo_en_gaveta: suma(ventas.efectivo, cobrosDeuda.efectivo),
      ganancia_estimada: suma(...top.map((p) => p.ganancia)),
      producto_estrella: top[0] || null,
      top_productos: top.slice(0, 5)
    };
  }

  /** "Cerrar Día y Guardar Reporte". Si ya estaba cerrado, recalcula y reemplaza. */
  async cerrarDia(idUsuario, body = {}) {
    const { hoy, fecha } = await this.#fechaDe(body.fecha);
    if (fecha > hoy) throw solicitudInvalida('No puedes cerrar un día que todavía no ocurrió.');
    const reporte = await this.dia(idUsuario, fecha);
    await ReporteRepository.guardarCierre(idUsuario, fecha, reporte);
    return this.dia(idUsuario, fecha);
  }

  historial(idUsuario, q = {}) {
    const limite = V.vacio(q.limite) ? 30 : V.entero(q.limite, 'El límite', { min: 1, max: 365 });
    return ReporteRepository.historialCierres(idUsuario, limite);
  }

  /** Pantalla de inicio: cómo va el día, qué hay que reponer y cuánto le deben. */
  async inicio(idUsuario) {
    const [hoy, stock, deuda] = await Promise.all([
      this.dia(idUsuario),
      ReporteRepository.conteoStock(idUsuario),
      ClienteRepository.totalDeuda(idUsuario)
    ]);
    return {
      hoy,
      stock: { agotados: stock.agotados, por_agotarse: stock.por_agotarse },
      fiados: { total_por_cobrar: redondear(deuda.total), vecinos_con_deuda: deuda.deudores }
    };
  }
}

module.exports = new ReporteService();
