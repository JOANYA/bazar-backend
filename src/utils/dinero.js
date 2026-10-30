// Dinero en céntimos enteros para sumar sin errores de coma flotante (0.1 + 0.2).
const aCentimos = (soles) => Math.round(Number(soles) * 100);
const aSoles = (centimos) => Math.round(centimos) / 100;
const redondear = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

module.exports = { aCentimos, aSoles, redondear };
