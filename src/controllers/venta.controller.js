const S = require('../services/VentaService');
const manejar = require('../utils/asyncHandler');
const { idDeRuta } = require('../utils/validaciones');

const id = (req) => idDeRuta(req.params.id, 'La venta');

exports.registrar = manejar(async (req, res) => {
  const { venta, repetida } = await S.registrar(req.idUsuario, req.body);
  // 200 si era un reenvío de una venta ya registrada; 201 si es nueva
  res.status(repetida ? 200 : 201).json({ ...venta, repetida });
}, 'No se pudo registrar la venta');

exports.listar = manejar(async (req, res) => res.json(await S.listar(req.idUsuario, req.query)));
exports.obtener = manejar(async (req, res) => res.json(await S.obtener(req.idUsuario, id(req))));
exports.anular = manejar(async (req, res) => res.json(await S.anular(req.idUsuario, id(req), req.body)));
