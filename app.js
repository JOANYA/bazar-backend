require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const pool = require('./src/config/db');
const { responderError, noEncontrado } = require('./src/utils/errores');

const app = express();

// Detrás de un proxy (Render, Railway, Nginx) hay que activarlo para que el límite de
// intentos use la IP real del usuario y no la del proxy.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 0);

app.use(helmet());
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

const origenes = (process.env.FRONTEND_URL || 'http://localhost:4200,http://localhost:5173')
  .split(',').map((o) => o.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => cb(null, !origin || origenes.includes(origin)), // sin Origin = Postman/cURL
  maxAge: 600
}));
app.use(express.json({ limit: '100kb' }));

// Anti fuerza bruta en los logins
const limitarLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LOGIN_MAX_INTENTOS) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'error', message: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' }
});
app.use('/api/auth/login', limitarLogin);
app.use('/api/auth/admin/login', limitarLogin);

app.get('/api/salud', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (_) {
    res.status(503).json({ status: 'error', message: 'Sin conexión a la base de datos' });
  }
});

app.use('/api/auth', require('./src/routes/authRoutes'));
app.use('/api/admin/tiendas', require('./src/routes/tiendaAdminRoutes'));
app.use('/api/productos', require('./src/routes/productoRoutes'));
app.use('/api/clientes', require('./src/routes/clienteRoutes'));
app.use('/api/ventas', require('./src/routes/ventaRoutes'));
app.use('/api/compras', require('./src/routes/compraRoutes'));
app.use('/api/reportes', require('./src/routes/reporteRoutes'));

app.use('/api', (req, res, next) => next(noEncontrado(`La ruta ${req.method} ${req.originalUrl} no existe.`)));

// Manejador final: todo error (de middlewares o controladores) sale con el mismo formato.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => responderError(err, res));

module.exports = app;
