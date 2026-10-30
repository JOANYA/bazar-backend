const router = require('express').Router();
const c = require('../controllers/cliente.controller');
const { verificarToken, soloTienda } = require('../middlewares/auth');

router.use(verificarToken, soloTienda);

router.get('/', c.listar);                 // ?q=don car  (autocompletar)  ?con_deuda=true (quién me debe)
router.post('/', c.crear);                 // solo "nombre" es obligatorio
router.get('/:id', c.detalle);             // ficha + historial del cuaderno
router.patch('/:id', c.actualizar);
router.post('/:id/pagos', c.registrarPago); // el vecino abona

module.exports = router;
