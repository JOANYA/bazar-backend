/** Suma/resta días a una fecha 'YYYY-MM-DD' sin depender de la zona horaria del servidor. */
function sumarDias(fecha, dias) {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
module.exports = { sumarDias };
