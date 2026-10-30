const { solicitudInvalida } = require('./errores');

const vacio = (v) => v === undefined || v === null || v === '';

/** Texto obligatorio u opcional, recortado. */
function texto(valor, etiqueta, { min = 0, max = 255, obligatorio = false } = {}) {
  if (vacio(valor)) {
    if (obligatorio) throw solicitudInvalida(`${etiqueta} es obligatorio.`);
    return null;
  }
  const t = String(valor).trim();
  if (t.length === 0) {
    if (obligatorio) throw solicitudInvalida(`${etiqueta} es obligatorio.`);
    return null;
  }
  if (t.length < min) throw solicitudInvalida(`${etiqueta} debe tener al menos ${min} caracteres.`);
  if (t.length > max) throw solicitudInvalida(`${etiqueta} no puede pasar de ${max} caracteres.`);
  return t;
}

function entero(valor, etiqueta, { min = 0, max = 1_000_000, obligatorio = false } = {}) {
  if (vacio(valor)) {
    if (obligatorio) throw solicitudInvalida(`${etiqueta} es obligatorio.`);
    return null;
  }
  const n = Number(valor);
  if (!Number.isInteger(n)) throw solicitudInvalida(`${etiqueta} debe ser un número entero.`);
  if (n < min) throw solicitudInvalida(`${etiqueta} debe ser como mínimo ${min}.`);
  if (n > max) throw solicitudInvalida(`${etiqueta} no puede ser mayor a ${max}.`);
  return n;
}

/** Monto en soles con máximo 2 decimales. */
function monto(valor, etiqueta, { min = 0, max = 99_999_999, obligatorio = false } = {}) {
  if (vacio(valor)) {
    if (obligatorio) throw solicitudInvalida(`${etiqueta} es obligatorio.`);
    return null;
  }
  const n = Number(valor);
  if (!Number.isFinite(n)) throw solicitudInvalida(`${etiqueta} debe ser un número.`);
  if (n < min) throw solicitudInvalida(`${etiqueta} debe ser como mínimo ${min}.`);
  if (n > max) throw solicitudInvalida(`${etiqueta} es demasiado grande.`);
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) {
    throw solicitudInvalida(`${etiqueta} admite como máximo 2 decimales.`);
  }
  return Math.round(n * 100) / 100;
}

function booleano(valor, etiqueta) {
  if (typeof valor === 'boolean') return valor;
  if (valor === 1 || valor === '1' || valor === 'true') return true;
  if (valor === 0 || valor === '0' || valor === 'false') return false;
  throw solicitudInvalida(`${etiqueta} debe ser verdadero o falso.`);
}

function enumerado(valor, etiqueta, opciones, { porDefecto } = {}) {
  if (vacio(valor)) {
    if (porDefecto !== undefined) return porDefecto;
    throw solicitudInvalida(`${etiqueta} es obligatorio.`);
  }
  if (!opciones.includes(valor)) {
    throw solicitudInvalida(`${etiqueta} no es válido. Opciones: ${opciones.join(', ')}.`);
  }
  return valor;
}

/** Fecha YYYY-MM-DD real (rechaza 2026-02-31). */
function fecha(valor, etiqueta = 'La fecha') {
  const t = String(valor ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) throw solicitudInvalida(`${etiqueta} debe tener formato AAAA-MM-DD.`);
  const d = new Date(`${t}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t) {
    throw solicitudInvalida(`${etiqueta} no es una fecha válida.`);
  }
  return t;
}

/** id de ruta (/:id) */
function idDeRuta(valor, etiqueta = 'El id') {
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) throw solicitudInvalida(`${etiqueta} no es válido.`);
  return n;
}

/** Escapa % _ \ para usar el texto del usuario dentro de un LIKE. */
const escaparLike = (t) => String(t).replace(/[\\%_]/g, (c) => `\\${c}`);

/** limit/offset de listados con tope. */
function paginacion(query, { limitePorDefecto = 50, limiteMax = 200 } = {}) {
  const limite = vacio(query.limite) ? limitePorDefecto : entero(query.limite, 'El límite', { min: 1, max: limiteMax });
  const desplazamiento = vacio(query.desde_fila) ? 0 : entero(query.desde_fila, 'desde_fila', { min: 0 });
  return { limite, desplazamiento };
}

module.exports = { vacio, texto, entero, monto, booleano, enumerado, fecha, idDeRuta, escaparLike, paginacion };
