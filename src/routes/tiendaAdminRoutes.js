const router = require('express').Router();
const c = require('../controllers/tiendaAdmin.controller');
const { verificarToken, soloAdmin } = require('../middlewares/auth');

router.use(verificarToken, soloAdmin);

router.get('/', c.listar);
router.post('/', c.crear);
router.get('/:id', c.obtener);
router.patch('/:id', c.actualizar); // nombre_tienda, telefono, estado (suspender/reactivar)
router.post('/:id/restablecer-password', c.restablecerPassword);

module.exports = router;
