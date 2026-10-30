const router = require('express').Router();
const c = require('../controllers/auth.controller');
const { verificarToken } = require('../middlewares/auth');

router.post('/login', c.loginTienda);          // tendera
router.post('/admin/login', c.loginAdmin);     // dueño de la plataforma
router.get('/me', verificarToken, c.perfil);
router.put('/password', verificarToken, c.cambiarPassword);

module.exports = router;
