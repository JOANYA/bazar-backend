const S = require('../services/ReporteService');
const manejar = require('../utils/asyncHandler');

exports.inicio = manejar(async (req, res) => res.json(await S.inicio(req.idUsuario)));
exports.dia = manejar(async (req, res) => res.json(await S.dia(req.idUsuario, req.query.fecha)));
exports.cerrarDia = manejar(async (req, res) => res.status(201).json(await S.cerrarDia(req.idUsuario, req.body)), 'No se pudo cerrar el día');
exports.historial = manejar(async (req, res) => res.json(await S.historial(req.idUsuario, req.query)));
