const router = require('express').Router();
const c = require('../controllers/compra.controller');
const { verificarToken, soloTienda } = require('../middlewares/auth');

router.use(verificarToken, soloTienda);

router.post('/', c.registrar);   // entrada de mercadería (factura del proveedor)
router.get('/', c.listar);       // ?desde=&hasta= (por defecto últimos 30 días)
router.get('/:id', c.obtener);

module.exports = router;
