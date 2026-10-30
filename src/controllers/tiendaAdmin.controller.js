const TiendaAdminService = require('../services/TiendaAdminService');
const manejar = require('../utils/asyncHandler');
const { idDeRuta } = require('../utils/validaciones');

exports.listar = manejar(async (req, res) => {
  res.json(await TiendaAdminService.listar(req.sesion.id, req.query.estado));
});
exports.obtener = manejar(async (req, res) => {
  res.json(await TiendaAdminService.obtener(req.sesion.id, idDeRuta(req.params.id)));
});
exports.crear = manejar(async (req, res) => {
  res.status(201).json(await TiendaAdminService.crear(req.sesion.id, req.body));
});
exports.actualizar = manejar(async (req, res) => {
  res.json(await TiendaAdminService.actualizar(req.sesion.id, idDeRuta(req.params.id), req.body));
});
exports.restablecerPassword = manejar(async (req, res) => {
  await TiendaAdminService.restablecerPassword(req.sesion.id, idDeRuta(req.params.id), req.body?.password);
  res.json({ mensaje: 'Contraseña restablecida.' });
});
