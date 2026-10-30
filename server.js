// Archivo alternativo para localhost (npm start usa ./bin/www).
// No usar ambos a la vez: elige uno. Se deja por compatibilidad.
require('dotenv').config();
var app = require('./app');
var http = require('http');

var port = process.env.PORT || '3000';
app.set('port', port);

var server = http.createServer(app);

// 👈 Importante: Especificar '0.0.0.0' como segundo parámetro para Render
server.listen(port, '0.0.0.0', function () {
  console.log('✅ Servidor corriendo en el puerto ' + port);
});