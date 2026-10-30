const router = require('express').Router();
const c = require('../controllers/venta.controller');
const { verificarToken, soloTienda } = require('../middlewares/auth');

router.use(verificarToken, soloTienda);

router.post('/', c.registrar);            // venta completa en un solo envío
router.get('/', c.listar);                // ?fecha=AAAA-MM-DD (por defecto hoy)  ?desde=&hasta=&metodo_pago=
router.get('/:id', c.obtener);
router.post('/:id/anular', c.anular);

module.exports = router;
