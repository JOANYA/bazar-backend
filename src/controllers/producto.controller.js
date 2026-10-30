const S = require('../services/ProductoService');
const manejar = require('../utils/asyncHandler');
const { idDeRuta } = require('../utils/validaciones');

const id = (req) => idDeRuta(req.params.id, 'El producto');

exports.listar = manejar(async (req, res) => res.json(await S.listar(req.idUsuario, req.query)));
exports.rapidos = manejar(async (req, res) => res.json(await S.rapidos(req.idUsuario, req.query)));
exports.alertas = manejar(async (req, res) => res.json(await S.alertas(req.idUsuario)));
exports.porCodigo = manejar(async (req, res) => res.json(await S.porCodigoBarras(req.idUsuario, req.params.codigo)));
exports.obtener = manejar(async (req, res) => res.json(await S.obtener(req.idUsuario, id(req))));

// Ahora enviamos req.body y req.file (para la imagen)
exports.crear = manejar(async (req, res) => res.status(201).json(await S.crear(req.idUsuario, req.body, req.file)));
exports.actualizar = manejar(async (req, res) => res.json(await S.actualizar(req.idUsuario, id(req), req.body, req.file)));

exports.favorito = manejar(async (req, res) => res.json(await S.marcarFavorito(req.idUsuario, id(req), req.body?.es_favorito)));
exports.desactivar = manejar(async (req, res) => { await S.desactivar(req.idUsuario, id(req)); res.status(204).end(); });
exports.reactivar = manejar(async (req, res) => res.json(await S.reactivar(req.idUsuario, id(req))));
exports.ajustarStock = manejar(async (req, res) => res.json(await S.ajustarStock(req.idUsuario, id(req), req.body)));
exports.movimientos = manejar(async (req, res) => res.json(await S.movimientos(req.idUsuario, id(req), req.query)));
exports.agregarPresentacion = manejar(async (req, res) => res.status(201).json(await S.agregarPresentacion(req.idUsuario, id(req), req.body)));
exports.quitarPresentacion = manejar(async (req, res) => {
  await S.quitarPresentacion(req.idUsuario, id(req), idDeRuta(req.params.idPresentacion, 'La presentación'));
  res.status(204).end();
});