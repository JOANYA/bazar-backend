const router = require('express').Router();
const c = require('../controllers/producto.controller');
const { verificarToken, soloTienda } = require('../middlewares/auth');
const { uploadImage } = require('../middlewares/upload'); // <--- Importante

router.use(verificarToken, soloTienda);

router.get('/', c.listar);                       
router.get('/rapidos', c.rapidos);               
router.get('/alertas', c.alertas);               
router.get('/codigo/:codigo', c.porCodigo);      

// Añadir uploadImage aquí
router.post('/', uploadImage, c.crear);

router.get('/:id', c.obtener);
router.patch('/:id', uploadImage, c.actualizar);  // <--- Añadir uploadImage aquí también
router.delete('/:id', c.desactivar);             
router.post('/:id/reactivar', c.reactivar);
router.patch('/:id/favorito', c.favorito);
router.post('/:id/ajuste-stock', c.ajustarStock);
router.get('/:id/movimientos', c.movimientos);
router.post('/:id/presentaciones', c.agregarPresentacion);
router.delete('/:id/presentaciones/:idPresentacion', c.quitarPresentacion);

module.exports = router;