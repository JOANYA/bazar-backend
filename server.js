const express = require('express');
const cors = require('cors'); // <--- 1. Importar cors
const app = express();

// 2. Configurar CORS para permitir peticiones desde tu frontend en Vercel y localhost
const dominiosPermitidos = [
  'https://bazar-frontend-xi.vercel.app', // Tu enlace de Vercel
  'http://localhost:4200'                 // Para cuando pruebas localmente
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || dominiosPermitidos.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Bloqueado por la política CORS'));
    }
  },
  credentials: true
}));

app.use(express.json());
// ... aquí van tus rutas normales (app.use('/auth', ...), etc.)