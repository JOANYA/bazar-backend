const S = require('../services/CompraService');
const manejar = require('../utils/asyncHandler');
const { idDeRuta } = require('../utils/validaciones');

exports.registrar = manejar(async (req, res) => res.status(201).json(await S.registrar(req.idUsuario, req.body)), 'No se pudo registrar la compra');
exports.listar = manejar(async (req, res) => res.json(await S.listar(req.idUsuario, req.query)));
exports.obtener = manejar(async (req, res) => res.json(await S.obtener(req.idUsuario, idDeRuta(req.params.id, 'La compra'))));
