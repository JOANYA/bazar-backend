const AuthService = require('../services/AuthService');
const manejar = require('../utils/asyncHandler');

exports.loginTienda = manejar(async (req, res) => {
  res.json(await AuthService.loginTienda(req.body?.usuario_login, req.body?.password));
}, 'No se pudo iniciar sesión');

exports.loginAdmin = manejar(async (req, res) => {
  res.json(await AuthService.loginAdmin(req.body?.correo, req.body?.password));
}, 'No se pudo iniciar sesión');

exports.perfil = manejar(async (req, res) => {
  res.json(await AuthService.perfil(req.sesion));
});

exports.cambiarPassword = manejar(async (req, res) => {
  await AuthService.cambiarPassword(req.sesion, req.body?.password_actual, req.body?.password_nueva);
  res.json({ mensaje: 'Contraseña actualizada.' });
});
