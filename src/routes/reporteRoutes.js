const router = require('express').Router();
const c = require('../controllers/reporte.controller');
const { verificarToken, soloTienda } = require('../middlewares/auth');

router.use(verificarToken, soloTienda);

router.get('/inicio', c.inicio);       // tablero de la pantalla principal
router.get('/dia', c.dia);             // ?fecha=AAAA-MM-DD (por defecto hoy): el cierre visual en vivo
router.post('/cierre', c.cerrarDia);   // "Cerrar Día y Guardar Reporte"  body opcional: { fecha }
router.get('/cierres', c.historial);   // historial de días cerrados

module.exports = router;
