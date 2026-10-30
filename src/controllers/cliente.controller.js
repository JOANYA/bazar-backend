const S = require('../services/ClienteService');
const manejar = require('../utils/asyncHandler');
const { idDeRuta } = require('../utils/validaciones');

const id = (req) => idDeRuta(req.params.id, 'El cliente');

exports.listar = manejar(async (req, res) => res.json(await S.listar(req.idUsuario, req.query)));
exports.crear = manejar(async (req, res) => res.status(201).json(await S.crear(req.idUsuario, req.body)));
exports.detalle = manejar(async (req, res) => res.json(await S.detalle(req.idUsuario, id(req), req.query)));
exports.actualizar = manejar(async (req, res) => res.json(await S.actualizar(req.idUsuario, id(req), req.body)));
exports.registrarPago = manejar(async (req, res) => res.status(201).json(await S.registrarPago(req.idUsuario, id(req), req.body)));
