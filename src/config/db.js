require('dotenv').config();
const mysql = require('mysql2/promise');

// Zona horaria del negocio (desfase fijo, Perú = -05:00).
// Sin esto, "hoy" lo decide el reloj del servidor MySQL (casi siempre UTC): a las
// 7 p.m. en Lima ya sería "mañana" y el cierre de caja saldría con el día equivocado.
const ZONA = process.env.DB_TIMEZONE || '-05:00';
const usarSSL = String(process.env.DB_SSL || 'false').toLowerCase() === 'true';

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'mysql-2ba43487-gaaaa.c.aivencloud.com',
  port: Number(process.env.DB_PORT) || 17760,
  user: process.env.DB_USER || 'avnadmin',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'db_bazar_vecino',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true, // DECIMAL llega como número, no como texto "12.50"
  dateStrings: true,    // fechas llegan como 'YYYY-MM-DD HH:mm:ss', sin desfases de JS
  timezone: ZONA,
  ...(usarSSL ? { ssl: { rejectUnauthorized: false } } : {})
});

// Cada conexión nueva trabaja con la hora del negocio (CURRENT_TIMESTAMP, CURDATE, NOW).
pool.pool.on('connection', (conn) => {
  conn.query('SET time_zone = ?', [ZONA]);
});

const REINTENTOS_DEADLOCK = 2;

/**
 * Ejecuta `fn(conn)` dentro de una transacción. Si algo lanza, se revierte todo.
 * Ante un deadlock (dos ventas simultáneas chocando) reintenta automáticamente.
 */
async function transaccion(fn) {
  for (let intento = 0; ; intento++) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const resultado = await fn(conn);
      await conn.commit();
      return resultado;
    } catch (error) {
      try { await conn.rollback(); } catch (_) { /* conexión ya perdida */ }
      if (error && error.code === 'ER_LOCK_DEADLOCK' && intento < REINTENTOS_DEADLOCK) continue;
      throw error;
    } finally {
      conn.release();
    }
  }
}

/** Fecha de "hoy" (YYYY-MM-DD) según la hora del negocio. */
async function fechaHoy(conn = pool) {
  const [[fila]] = await conn.query('SELECT CURDATE() AS hoy');
  return fila.hoy;
}

async function probarConexion() {
  const [[fila]] = await pool.query('SELECT DATABASE() AS db, NOW() AS ahora');
  return fila;
}

module.exports = pool;
module.exports.transaccion = transaccion;
module.exports.fechaHoy = fechaHoy;
module.exports.probarConexion = probarConexion;
